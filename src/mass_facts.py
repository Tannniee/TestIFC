"""IFC fact gathering for mass take-off.

This module owns traversal and reports what the IFC file says. Candidate
ranking, representative-value selection, and summation belong in ``mass``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from math import pi, sqrt
from os import cpu_count
from typing import Sequence

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.shape
import ifcopenshell.util.unit

from ifc_units import lengths_to_m, named_unit_scale_to_si


@dataclass(frozen=True)
class UnitFacts:
    length_m_per_project_unit: float | None
    area_m2_per_project_unit: float | None
    volume_m3_per_project_unit: float | None
    mass_grams_per_project_unit: float | None
    length_unit_entity_id: int | None
    area_unit_entity_id: int | None
    volume_unit_entity_id: int | None
    mass_unit_entity_id: int | None


@dataclass(frozen=True)
class MassMeasureFact:
    raw_value: float
    source_entity_id: int
    entity_kind: str
    measure_type: str
    unit_resolution: str
    mass_scale_to_grams: float | None


@dataclass(frozen=True)
class AuthoredWeightFacts:
    quantity_weights: tuple[MassMeasureFact, ...]
    property_weights: tuple[MassMeasureFact, ...]
    invalid_quantity_source_ids: tuple[int, ...]
    invalid_property_source_ids: tuple[int, ...]
    has_quantity_weight: bool


@dataclass(frozen=True)
class VolumeMeasureFact:
    raw_value: float
    source_entity_id: int
    quantity_name: str
    unit_resolution: str
    volume_scale_to_m3: float | None


@dataclass(frozen=True)
class AuthoredVolumeFacts:
    measures: tuple[VolumeMeasureFact, ...]
    invalid_source_ids: tuple[int, ...]
    has_quantity_volume: bool


@dataclass(frozen=True)
class AnalyticFacts:
    volume_m3: float | None
    length_m: float | None
    source_entity_ids: tuple[int, ...]
    method: str | None = None
    unsupported_item_types: tuple[str, ...] = ()


@dataclass(frozen=True)
class MeshFacts:
    volume_m3: float | None
    length_m: float | None
    source_entity_ids: tuple[int, ...]
    unsupported_item_types: tuple[str, ...] = ()
    method: str | None = None


@dataclass(frozen=True)
class PartFacts:
    entity_id: int
    global_id: str
    ifc_type: str
    object_type: str | None
    material_name: str | None
    material_source_entity_ids: tuple[int, ...]
    mesh: MeshFacts
    length_m_per_project_unit: float | None
    authored_volume: AuthoredVolumeFacts = field(
        default_factory=lambda: AuthoredVolumeFacts((), (), False)
    )
    analytic: AnalyticFacts = field(
        default_factory=lambda: AnalyticFacts(None, None, ())
    )


@dataclass(frozen=True)
class AssemblyFacts:
    model_hash: str
    assembly_global_id: str
    assembly_entity_id: int
    name: str | None
    authored_weight: AuthoredWeightFacts
    parts: tuple[PartFacts, ...]
    selected_part_ids: tuple[int, ...] | None


def gather_project_units(ifc_file: ifcopenshell.file) -> UnitFacts:
    length = ifcopenshell.util.unit.get_project_unit(ifc_file, "LENGTHUNIT")
    area = ifcopenshell.util.unit.get_project_unit(ifc_file, "AREAUNIT")
    volume = ifcopenshell.util.unit.get_project_unit(ifc_file, "VOLUMEUNIT")
    mass = ifcopenshell.util.unit.get_project_unit(ifc_file, "MASSUNIT")
    return UnitFacts(
        named_unit_scale_to_si(length) if length is not None else None,
        named_unit_scale_to_si(area) if area is not None else None,
        (
            named_unit_scale_to_si(volume)
            if volume is not None
            else (
                named_unit_scale_to_si(length) ** 3
                if length is not None and named_unit_scale_to_si(length) is not None
                else None
            )
        ),
        named_unit_scale_to_si(mass) if mass is not None else None,
        length.id() if length is not None else None,
        area.id() if area is not None else None,
        volume.id() if volume is not None else None,
        mass.id() if mass is not None else None,
    )


def _mass_measure_fact(
    raw_value: float,
    entity,
    measure_type: str,
    explicit_unit,
    units: UnitFacts,
) -> MassMeasureFact:
    if explicit_unit is None:
        return MassMeasureFact(
            raw_value,
            entity.id(),
            entity.is_a(),
            measure_type,
            "project_mass_unit",
            units.mass_grams_per_project_unit,
        )
    is_mass = getattr(explicit_unit, "UnitType", None) == "MASSUNIT"
    scale = named_unit_scale_to_si(explicit_unit) if is_mass else None
    resolution = "explicit_mass_unit" if scale is not None else "unit_unresolved"
    return MassMeasureFact(
        raw_value,
        entity.id(),
        entity.is_a(),
        measure_type,
        resolution,
        scale,
    )


def _quantity_weight_facts(quantity_set, units: UnitFacts):
    facts = []
    invalid = []
    seen = False
    for quantity in quantity_set.Quantities or ():
        if not quantity.is_a("IfcQuantityWeight"):
            continue
        seen = True
        raw = getattr(quantity, "WeightValue", None)
        if not isinstance(raw, int | float):
            invalid.append(quantity.id())
            continue
        facts.append(
            _mass_measure_fact(
                float(raw), quantity, "IfcQuantityWeight", quantity.Unit, units
            )
        )
    return facts, invalid, seen


def _property_weight_facts(property_set, units: UnitFacts):
    facts = []
    invalid = []
    for property_value in property_set.HasProperties or ():
        if (
            not property_value.is_a("IfcPropertySingleValue")
            or str(property_value.Name or "").upper() != "WEIGHT"
        ):
            continue
        nominal = property_value.NominalValue
        if nominal is None or not nominal.is_a("IfcMassMeasure"):
            invalid.append(property_value.id())
            continue
        raw = nominal.wrappedValue
        if not isinstance(raw, int | float):
            invalid.append(property_value.id())
            continue
        facts.append(
            _mass_measure_fact(
                float(raw),
                property_value,
                nominal.is_a(),
                property_value.Unit,
                units,
            )
        )
    return facts, invalid


def gather_authored_weight_facts(element, units: UnitFacts) -> AuthoredWeightFacts:
    quantities = []
    properties = []
    invalid_quantities = []
    invalid_properties = []
    has_quantity = False
    for relation in getattr(element, "IsDefinedBy", ()) or ():
        if not relation.is_a("IfcRelDefinesByProperties"):
            continue
        definition = relation.RelatingPropertyDefinition
        if definition is None:
            continue
        if definition.is_a("IfcElementQuantity"):
            found, invalid, seen = _quantity_weight_facts(definition, units)
            quantities.extend(found)
            invalid_quantities.extend(invalid)
            has_quantity = has_quantity or seen
        elif definition.is_a("IfcPropertySet"):
            found, invalid = _property_weight_facts(definition, units)
            properties.extend(found)
            invalid_properties.extend(invalid)
    return AuthoredWeightFacts(
        tuple(quantities),
        tuple(properties),
        tuple(invalid_quantities),
        tuple(invalid_properties),
        has_quantity,
    )


def gather_authored_volume_facts(element, units: UnitFacts) -> AuthoredVolumeFacts:
    measures = []
    invalid = []
    has_quantity = False
    for relation in getattr(element, "IsDefinedBy", ()) or ():
        if not relation.is_a("IfcRelDefinesByProperties"):
            continue
        definition = relation.RelatingPropertyDefinition
        if definition is None or not definition.is_a("IfcElementQuantity"):
            continue
        for quantity in definition.Quantities or ():
            if not quantity.is_a("IfcQuantityVolume"):
                continue
            name = str(quantity.Name or "")
            if name.upper() not in {"NETVOLUME", "GROSSVOLUME"}:
                continue
            has_quantity = True
            raw = getattr(quantity, "VolumeValue", None)
            if not isinstance(raw, int | float):
                invalid.append(quantity.id())
                continue
            explicit = getattr(quantity, "Unit", None)
            if explicit is None:
                scale = units.volume_m3_per_project_unit
                resolution = "project_volume_unit"
            else:
                is_volume = getattr(explicit, "UnitType", None) == "VOLUMEUNIT"
                scale = named_unit_scale_to_si(explicit) if is_volume else None
                resolution = "explicit_volume_unit" if scale is not None else "unit_unresolved"
            measures.append(
                VolumeMeasureFact(float(raw), quantity.id(), name, resolution, scale)
            )
    return AuthoredVolumeFacts(tuple(measures), tuple(invalid), has_quantity)


def _shape_items(product) -> tuple:
    representation = getattr(product, "Representation", None)
    if representation is None:
        return ()
    return tuple(
        item
        for shape in representation.Representations or ()
        for item in shape.Items or ()
    )


def _profile_area(profile, length_scale: float) -> float | None:
    scale2 = length_scale**2
    if profile.is_a("IfcRectangleHollowProfileDef"):
        outer = float(profile.XDim) * float(profile.YDim)
        thickness = float(profile.WallThickness)
        inner_x = float(profile.XDim) - 2.0 * thickness
        inner_y = float(profile.YDim) - 2.0 * thickness
        if min(inner_x, inner_y, thickness) <= 0.0:
            return None
        return (outer - inner_x * inner_y) * scale2
    if profile.is_a("IfcRectangleProfileDef"):
        return float(profile.XDim) * float(profile.YDim) * scale2
    if profile.is_a("IfcCircleHollowProfileDef"):
        radius = float(profile.Radius)
        thickness = float(profile.WallThickness)
        inner = radius - thickness
        if min(inner, thickness) <= 0.0:
            return None
        return pi * (radius**2 - inner**2) * scale2
    if profile.is_a("IfcCircleProfileDef"):
        radius = float(profile.Radius)
        return pi * radius**2 * scale2 if radius > 0.0 else None
    if profile.is_a("IfcIShapeProfileDef"):
        width = float(profile.OverallWidth)
        depth = float(profile.OverallDepth)
        web = float(profile.WebThickness)
        flange = float(profile.FlangeThickness)
        if min(width, depth, web, flange) <= 0.0 or depth <= 2.0 * flange:
            return None
        if any(
            float(getattr(profile, name, 0.0) or 0.0) != 0.0
            for name in ("FilletRadius", "FlangeEdgeRadius", "FlangeSlope")
        ):
            return None
        return (2.0 * width * flange + (depth - 2.0 * flange) * web) * scale2
    return None


def _polyline_length(curve, length_scale: float) -> float | None:
    if not curve.is_a("IfcPolyline"):
        return None
    points = tuple(tuple(float(value) for value in point.Coordinates) for point in curve.Points or ())
    if len(points) < 2:
        return None
    length = 0.0
    for first, second in zip(points, points[1:]):
        dimensions = max(len(first), len(second))
        delta = [
            (second[index] if index < len(second) else 0.0)
            - (first[index] if index < len(first) else 0.0)
            for index in range(dimensions)
        ]
        length += sqrt(sum(value * value for value in delta))
    return length * length_scale


def _combine_analytic(facts: Sequence[AnalyticFacts]) -> AnalyticFacts:
    unsupported = tuple(
        sorted(name for fact in facts for name in fact.unsupported_item_types)
    )
    if not facts or any(fact.volume_m3 is None for fact in facts):
        return AnalyticFacts(None, None, (), None, unsupported)
    sources = tuple(
        sorted({entity_id for fact in facts for entity_id in fact.source_entity_ids})
    )
    lengths = tuple(fact.length_m for fact in facts if fact.length_m is not None)
    methods = {fact.method for fact in facts}
    return AnalyticFacts(
        sum(float(fact.volume_m3) for fact in facts),
        max(lengths) if lengths else None,
        sources,
        next(iter(methods)) if len(methods) == 1 else "sum_of_analytic_items",
        unsupported,
    )


def _analytic_from_item(item, length_scale: float) -> AnalyticFacts:
    if item.is_a("IfcExtrudedAreaSolid"):
        area = _profile_area(item.SweptArea, length_scale)
        depth = float(item.Depth) * length_scale
        if area is None or depth <= 0.0:
            return AnalyticFacts(None, None, (item.id(),), None, (item.SweptArea.is_a(),))
        return AnalyticFacts(
            area * depth,
            depth,
            (item.id(), item.SweptArea.id()),
            "ifc_extruded_area_solid",
        )
    if item.is_a("IfcSweptDiskSolid"):
        length = _polyline_length(item.Directrix, length_scale)
        radius = float(item.Radius) * length_scale
        inner = float(item.InnerRadius or 0.0) * length_scale
        if length is None or radius <= inner or inner < 0.0:
            return AnalyticFacts(None, None, (item.id(),), None, (item.Directrix.is_a(),))
        return AnalyticFacts(
            pi * (radius**2 - inner**2) * length,
            length,
            (item.id(), item.Directrix.id()),
            "ifc_swept_disk_solid",
        )
    if item.is_a("IfcMappedItem"):
        mapped = _combine_analytic(
            tuple(
                _analytic_from_item(source, length_scale)
                for source in item.MappingSource.MappedRepresentation.Items or ()
            )
        )
        if mapped.volume_m3 is None:
            return mapped
        factors = _mapping_scale_factors(item.MappingTarget)
        uniform = factors[0] == factors[1] == factors[2]
        length = (
            mapped.length_m * abs(factors[0])
            if mapped.length_m is not None and uniform
            else None
        )
        return AnalyticFacts(
            mapped.volume_m3 * abs(factors[0] * factors[1] * factors[2]),
            length,
            tuple(sorted({item.id(), *mapped.source_entity_ids})),
            "mapped_analytic",
            mapped.unsupported_item_types,
        )
    return AnalyticFacts(None, None, (item.id(),), None, (item.is_a(),))


def gather_analytic_facts(product, units: UnitFacts) -> AnalyticFacts:
    if units.length_m_per_project_unit is None:
        return AnalyticFacts(None, None, ())
    return _combine_analytic(
        tuple(
            _analytic_from_item(item, units.length_m_per_project_unit)
            for item in _shape_items(product)
        )
    )


def _loop_points(bound, length_scale: float):
    loop = bound.Bound
    if not loop.is_a("IfcPolyLoop"):
        raise NotImplementedError(f"Unsupported face loop: {loop.is_a()}")
    points = tuple(
        tuple(lengths_to_m(point.Coordinates, length_scale))
        for point in loop.Polygon or ()
    )
    if len(points) < 3:
        raise ValueError("IfcPolyLoop must contain at least three points")
    return tuple((point[0], point[1], point[2]) for point in points)


def _tetrahedron_volume(a: Sequence[float], b: Sequence[float], c: Sequence[float]):
    return (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        + a[1] * (b[2] * c[0] - b[0] * c[2])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6.0


def _loop_signed_volume(points, orientation):
    ordered = points if orientation else tuple(reversed(points))
    return sum(
        _tetrahedron_volume(ordered[0], ordered[index], ordered[index + 1])
        for index in range(1, len(ordered) - 1)
    )


def _longest_extent(points):
    return max(
        max(point[axis] for point in points) - min(point[axis] for point in points)
        for axis in range(3)
    )


def _closed_shell_metrics(shell, length_scale: float):
    signed_volume = 0.0
    points = []
    for face in shell.CfsFaces or ():
        for bound in face.Bounds or ():
            if not bound.is_a("IfcFaceBound"):
                raise NotImplementedError(f"Unsupported face bound: {bound.is_a()}")
            loop = _loop_points(bound, length_scale)
            signed_volume += _loop_signed_volume(loop, bool(bound.Orientation))
            points.extend(loop)
    if not points:
        raise ValueError("IfcClosedShell has no face points")
    return abs(signed_volume), _longest_extent(points)


def _combine_meshes(meshes: Sequence[MeshFacts]) -> MeshFacts:
    unsupported = tuple(
        sorted(name for mesh in meshes for name in mesh.unsupported_item_types)
    )
    if not meshes or any(mesh.volume_m3 is None for mesh in meshes):
        return MeshFacts(None, None, (), unsupported)
    complete = tuple(mesh for mesh in meshes if mesh.volume_m3 is not None)
    sources = tuple(sorted({entity_id for mesh in complete for entity_id in mesh.source_entity_ids}))
    lengths = tuple(mesh.length_m for mesh in complete if mesh.length_m is not None)
    return MeshFacts(
        sum(float(mesh.volume_m3) for mesh in complete),
        max(lengths) if lengths else None,
        sources,
        unsupported,
        (
            next(iter({mesh.method for mesh in complete}))
            if len({mesh.method for mesh in complete}) == 1
            else "sum_of_mesh_items"
        ),
    )


def _mapping_scale_factors(target):
    """Return the three mapping scales, applying IFC's default of 1.0."""
    scale = float(target.Scale) if target.Scale is not None else 1.0
    if not target.is_a("IfcCartesianTransformationOperator3DnonUniform"):
        return scale, scale, scale
    scale2 = float(target.Scale2) if target.Scale2 is not None else 1.0
    scale3 = float(target.Scale3) if target.Scale3 is not None else 1.0
    return scale, scale2, scale3


def _mesh_from_item(item, length_scale: float) -> MeshFacts:
    if item.is_a("IfcFacetedBrep"):
        volume, length = _closed_shell_metrics(item.Outer, length_scale)
        return MeshFacts(
            volume, length, (item.id(), item.Outer.id()), (), "faceted_brep"
        )
    if item.is_a("IfcMappedItem"):
        mapped = tuple(
            _mesh_from_item(source, length_scale)
            for source in item.MappingSource.MappedRepresentation.Items or ()
        )
        child = _combine_meshes(mapped)
        if child.volume_m3 is None:
            return child
        factors = _mapping_scale_factors(item.MappingTarget)
        sources = tuple(sorted({item.id(), *child.source_entity_ids}))
        uniform = factors[0] == factors[1] == factors[2]
        length = (
            child.length_m * abs(factors[0])
            if child.length_m is not None and uniform
            else None
        )
        volume_factor = abs(factors[0] * factors[1] * factors[2])
        return MeshFacts(
            float(child.volume_m3) * volume_factor,
            length,
            sources,
            child.unsupported_item_types,
            "mapped_mesh",
        )
    return MeshFacts(None, None, (item.id(),), (item.is_a(),))


def gather_mesh_facts(product, units: UnitFacts) -> MeshFacts:
    if units.length_m_per_project_unit is None:
        return MeshFacts(None, None, ())
    return _combine_meshes(
        tuple(
            _mesh_from_item(item, units.length_m_per_project_unit)
            for item in _shape_items(product)
        )
    )


def gather_iterator_mesh_facts(
    ifc_file,
    products: Sequence,
    units: UnitFacts,
) -> dict[int, MeshFacts]:
    """Tessellate unsupported products in one geometry-iterator pass."""
    if not products or units.length_m_per_project_unit is None:
        return {}
    settings = ifcopenshell.geom.settings()
    settings.set("convert-back-units", True)
    iterator = ifcopenshell.geom.iterator(
        settings,
        ifc_file,
        max(1, cpu_count() or 1),
        include=list(products),
    )
    if not iterator.initialize():
        return {}
    scale = units.length_m_per_project_unit
    results = {}
    while True:
        shape = iterator.get()
        geometry = shape.geometry
        vertices = ifcopenshell.util.shape.get_vertices(geometry)
        minimum, maximum = ifcopenshell.util.shape.get_bbox(vertices)
        length = max(float(maximum[index] - minimum[index]) for index in range(3)) * scale
        volume = float(ifcopenshell.util.shape.get_volume(geometry)) * scale**3
        results[int(shape.id)] = MeshFacts(
            volume,
            length,
            (int(shape.id),),
            (),
            "geometry_iterator",
        )
        if not iterator.next():
            break
    return results


def _material_facts(product):
    matches = []
    for relation in getattr(product, "HasAssociations", ()) or ():
        material = getattr(relation, "RelatingMaterial", None)
        if (
            not relation.is_a("IfcRelAssociatesMaterial")
            or material is None
            or not material.is_a("IfcMaterial")
            or not material.Name
        ):
            continue
        matches.append((str(material.Name), relation.id()))
    names = {name for name, _ in matches}
    if len(names) == 1:
        return next(iter(names)), tuple(relation_id for _, relation_id in matches)
    return None, ()


def gather_part_facts(product, units: UnitFacts) -> PartFacts:
    material_name, material_ids = _material_facts(product)
    global_id = getattr(product, "GlobalId", None)
    if not isinstance(global_id, str):
        raise ValueError("Take-off part requires GlobalId")
    return PartFacts(
        product.id(),
        global_id,
        product.is_a(),
        getattr(product, "ObjectType", None),
        material_name,
        material_ids,
        gather_mesh_facts(product, units),
        units.length_m_per_project_unit,
        gather_authored_volume_facts(product, units),
        gather_analytic_facts(product, units),
    )


def gather_parts_facts(
    ifc_file,
    products: Sequence,
    units: UnitFacts,
    cache=None,
) -> tuple[PartFacts, ...]:
    resolved = {}
    uncached = []
    raw = {}
    for product in products:
        cached = cache.get_part(product.id()) if cache is not None else None
        if cached is not None:
            resolved[product.id()] = cached
            continue
        facts = gather_part_facts(product, units)
        raw[product.id()] = facts
        uncached.append(product)

    needs_iterator = tuple(
        product
        for product in uncached
        if raw[product.id()].analytic.volume_m3 is None
        and raw[product.id()].mesh.volume_m3 is None
    )
    try:
        iterator_facts = gather_iterator_mesh_facts(ifc_file, needs_iterator, units)
    except Exception:
        iterator_facts = {}
    for product in uncached:
        facts = raw[product.id()]
        fallback = iterator_facts.get(product.id())
        if fallback is not None:
            facts = replace(facts, mesh=fallback)
        resolved[product.id()] = facts
        if cache is not None:
            cache.put_part(facts)
    return tuple(resolved[product.id()] for product in products)


def cached_part_facts(ifc_file, product, units: UnitFacts, cache=None) -> PartFacts:
    return gather_parts_facts(ifc_file, (product,), units, cache)[0]


def part_facts_to_record(facts: PartFacts) -> dict:
    """Serialize density-independent raw facts for the versioned facts cache."""
    return asdict(facts)


def part_facts_from_record(record: dict) -> PartFacts:
    authored = record.get("authored_volume") or {}
    analytic = record.get("analytic") or {}
    mesh = record.get("mesh") or {}
    return PartFacts(
        int(record["entity_id"]),
        str(record["global_id"]),
        str(record["ifc_type"]),
        record.get("object_type"),
        record.get("material_name"),
        tuple(int(value) for value in record.get("material_source_entity_ids", ())),
        MeshFacts(
            mesh.get("volume_m3"),
            mesh.get("length_m"),
            tuple(int(value) for value in mesh.get("source_entity_ids", ())),
            tuple(str(value) for value in mesh.get("unsupported_item_types", ())),
            mesh.get("method"),
        ),
        record.get("length_m_per_project_unit"),
        AuthoredVolumeFacts(
            tuple(
                VolumeMeasureFact(
                    float(item["raw_value"]),
                    int(item["source_entity_id"]),
                    str(item["quantity_name"]),
                    str(item["unit_resolution"]),
                    item.get("volume_scale_to_m3"),
                )
                for item in authored.get("measures", ())
            ),
            tuple(int(value) for value in authored.get("invalid_source_ids", ())),
            bool(authored.get("has_quantity_volume", False)),
        ),
        AnalyticFacts(
            analytic.get("volume_m3"),
            analytic.get("length_m"),
            tuple(int(value) for value in analytic.get("source_entity_ids", ())),
            analytic.get("method"),
            tuple(str(value) for value in analytic.get("unsupported_item_types", ())),
        ),
    )


def _assembly_children(assembly):
    return tuple(
        child
        for relation in getattr(assembly, "IsDecomposedBy", ()) or ()
        if relation.is_a("IfcRelAggregates")
        for child in relation.RelatedObjects or ()
    )


def takeoff_subject(element):
    """Resolve a selected part upward to its IFC element assembly, if any."""
    if element.is_a("IfcElementAssembly"):
        return element
    for relation in getattr(element, "Decomposes", ()) or ():
        if not relation.is_a("IfcRelAggregates"):
            continue
        parent = relation.RelatingObject
        if parent is not None and parent.is_a("IfcElementAssembly"):
            return parent
    return element


def _subject_parts(subject):
    children = _assembly_children(subject)
    if children:
        return children
    if subject.is_a("IfcElementAssembly"):
        return ()
    return (subject,)


def gather_assembly_facts(
    ifc_file,
    assembly,
    model_hash: str,
    selected_part_ids: Sequence[int] | None = None,
    cache=None,
) -> AssemblyFacts:
    units = gather_project_units(ifc_file)
    global_id = getattr(assembly, "GlobalId", None)
    if not isinstance(global_id, str):
        raise ValueError("Take-off assembly requires GlobalId")
    selected = tuple(sorted(selected_part_ids)) if selected_part_ids is not None else None
    products = _subject_parts(assembly)
    parts = gather_parts_facts(ifc_file, products, units, cache)
    return AssemblyFacts(
        model_hash,
        global_id,
        assembly.id(),
        getattr(assembly, "Name", None),
        gather_authored_weight_facts(assembly, units),
        parts,
        selected,
    )


@dataclass(frozen=True)
class MaterialUse:
    name: str
    part_count: int
    with_geometry_count: int


def survey_materials(ifc_file) -> tuple[MaterialUse, ...]:
    counts = {}
    for product in ifc_file.by_type("IfcElement"):
        name, _ = _material_facts(product)
        if name is None:
            continue
        tally = counts.setdefault(name, [0, 0])
        tally[0] += 1
        if getattr(product, "Representation", None) is not None:
            tally[1] += 1
    return tuple(
        MaterialUse(name, tally[0], tally[1])
        for name, tally in sorted(counts.items())
    )
