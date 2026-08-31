"""IFC fact gathering for mass take-off.

This module owns traversal and reports what the IFC file says. Candidate
ranking, representative-value selection, and summation belong in ``mass``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import ifcopenshell
import ifcopenshell.util.unit

from ifc_units import lengths_to_m, named_unit_scale_to_si


@dataclass(frozen=True)
class UnitFacts:
    length_m_per_project_unit: float | None
    area_m2_per_project_unit: float | None
    mass_grams_per_project_unit: float | None
    length_unit_entity_id: int | None
    area_unit_entity_id: int | None
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
class MeshFacts:
    volume_m3: float | None
    length_m: float | None
    source_entity_ids: tuple[int, ...]
    unsupported_item_types: tuple[str, ...] = ()


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
    mass = ifcopenshell.util.unit.get_project_unit(ifc_file, "MASSUNIT")
    return UnitFacts(
        named_unit_scale_to_si(length) if length is not None else None,
        named_unit_scale_to_si(area) if area is not None else None,
        named_unit_scale_to_si(mass) if mass is not None else None,
        length.id() if length is not None else None,
        area.id() if area is not None else None,
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


def _shape_items(product) -> tuple:
    representation = getattr(product, "Representation", None)
    if representation is None:
        return ()
    return tuple(
        item
        for shape in representation.Representations or ()
        for item in shape.Items or ()
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
        return MeshFacts(volume, length, (item.id(), item.Outer.id()))
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
        return MeshFacts(float(child.volume_m3) * volume_factor, length, sources)
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
) -> AssemblyFacts:
    units = gather_project_units(ifc_file)
    global_id = getattr(assembly, "GlobalId", None)
    if not isinstance(global_id, str):
        raise ValueError("Take-off assembly requires GlobalId")
    selected = tuple(sorted(selected_part_ids)) if selected_part_ids is not None else None
    parts = tuple(gather_part_facts(part, units) for part in _subject_parts(assembly))
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
