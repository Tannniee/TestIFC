"""Semantic records and optional geometry for IFC elements."""

from __future__ import annotations

from typing import Any

import ifcopenshell.geom
import ifcopenshell.util.classification
import ifcopenshell.util.element
import ifcopenshell.util.shape
import ifcopenshell.util.unit
import numpy as np

import ifc_units
import model_runtime


def _find_quantity(quantities: dict, *names: str) -> float | None:
    for qto in quantities.values():
        for name in names:
            value = qto.get(name)
            if isinstance(value, int | float):
                return float(value)
    return None


def _has_authored_weight(quantities: dict) -> bool:
    weight_keys = ("NetWeight", "GrossWeight")
    return any(key in qto for qto in quantities.values() for key in weight_keys)


def _compute_mass_kg(
    element: Any,
    units: ifc_units.ProjectUnits,
    quantities: dict,
) -> float | None:
    if not units.has_mass_unit:
        return None
    density = ifcopenshell.util.element.get_element_mass_density(element)
    if density is None:
        return None
    volume = _find_quantity(quantities, "NetVolume", "GrossVolume")
    if volume is None:
        return None
    return ifc_units.mass_to_kilograms(density * volume, units.mass_scale)


def direct_children(entity: Any) -> list[Any]:
    children = []
    for relation in getattr(entity, "IsDecomposedBy", []) or []:
        children.extend(relation.RelatedObjects or [])
    for relation in getattr(entity, "ContainsElements", []) or []:
        children.extend(relation.RelatedElements or [])
    for relation in getattr(entity, "IsNestedBy", []) or []:
        children.extend(relation.RelatedObjects or [])
    for relation in getattr(entity, "HasOpenings", []) or []:
        children.append(relation.RelatedOpeningElement)
    for relation in getattr(entity, "HasFillings", []) or []:
        children.append(relation.RelatedBuildingElement)
    unique = {child.id(): child for child in children if child is not None}
    return sorted(
        unique.values(),
        key=lambda child: (
            child.is_a(),
            str(getattr(child, "Name", "") or ""),
            child.id(),
        ),
    )


def build_hot_record(element: Any) -> dict:
    """Return identity fields required before expensive semantic extraction."""
    record = {
        "globalId": getattr(element, "GlobalId", None),
        "expressId": element.id(),
        "ifcType": element.is_a(),
        "name": getattr(element, "Name", None),
        "objectType": getattr(element, "ObjectType", None),
        "description": getattr(element, "Description", None),
    }
    type_entity = ifcopenshell.util.element.get_type(element)
    if type_entity is not None and type_entity.id() != element.id():
        record["type"] = {
            "expressId": type_entity.id(),
            "ifcType": type_entity.is_a(),
            "name": getattr(type_entity, "Name", None),
        }
    material = ifcopenshell.util.element.get_material(element, should_skip_usage=True)
    if material is not None:
        record["material"] = {
            "expressId": material.id(),
            "ifcType": material.is_a(),
            "name": getattr(material, "Name", None),
        }
    return record


def _classification_records(element: Any) -> list[dict]:
    records = [
        {
            "expressId": reference.id(),
            "identification": getattr(reference, "Identification", None),
            "name": getattr(reference, "Name", None),
        }
        for reference in ifcopenshell.util.classification.get_references(element)
    ]
    return sorted(
        records,
        key=lambda record: (
            str(record["identification"] or ""),
            str(record["name"] or ""),
            record["expressId"],
        ),
    )


def build_cold_record(
    element: Any,
    ifc_file: Any,
    project_unit_state: ifc_units.ProjectUnits | None = None,
) -> dict:
    resolved_units = project_unit_state or ifc_units.project_units(ifc_file)
    properties = ifcopenshell.util.element.get_psets(element, psets_only=True) or {}
    quantities = ifcopenshell.util.element.get_psets(element, qtos_only=True) or {}
    unit_record = {
        "lengthUnit": "m",
        "projectLengthUnitScaleToMeters": resolved_units.length_scale,
    }
    normalized_quantities, resolved_unit_kinds = ifc_units.normalize_quantities(
        element,
        quantities,
        resolved_units,
    )
    if "area" in resolved_unit_kinds:
        unit_record["areaUnit"] = "m2"
    if "volume" in resolved_unit_kinds:
        unit_record["volumeUnit"] = "m3"
    if "mass" in resolved_unit_kinds:
        unit_record["massUnit"] = "kg"

    if not _has_authored_weight(quantities):
        mass_kg = _compute_mass_kg(element, resolved_units, quantities)
        if mass_kg is not None:
            normalized_quantities = {
                **normalized_quantities,
                "Computed": {"Mass": mass_kg},
            }
            unit_record["massUnit"] = "kg"

    return {
        "properties": properties,
        "quantities": normalized_quantities,
        "classifications": _classification_records(element),
        "units": unit_record,
    }


def build_semantic_record(
    element: Any,
    ifc_file: Any,
    project_unit_state: ifc_units.ProjectUnits | None = None,
) -> dict:
    """Build the complete record for compatibility and offline callers."""
    return {
        **build_hot_record(element),
        **build_cold_record(element, ifc_file, project_unit_state),
    }


def build_geometry(element: Any, unit_scale: float) -> dict | None:
    try:
        settings = ifcopenshell.geom.settings()
        settings.set("convert-back-units", True)
        shape = ifcopenshell.geom.create_shape(settings, element)
        geometry = shape.geometry
        verts = ifc_units.lengths_to_m(list(geometry.verts), unit_scale)
        grouped = ifcopenshell.util.shape.get_vertices(geometry)
        minimum, maximum = ifcopenshell.util.shape.get_bbox(grouped)
        matrix = np.array(
            list(shape.transformation.matrix),
            dtype=float,
        ).reshape((4, 4), order="F").tolist()
        return {
            "verts": verts,
            "faces": list(geometry.faces),
            "matrix": matrix,
            "bbox": [
                ifc_units.lengths_to_m(minimum, unit_scale),
                ifc_units.lengths_to_m(maximum, unit_scale),
            ],
        }
    except Exception:
        return None


def _with_geometry(lease: model_runtime.ModelLease, record: dict, express_id: int) -> dict:
    if not model_runtime.should_open_ref_for_geometry(lease.ref):
        return {
            **record,
            "geometry": None,
            "geometryStatus": "not_loaded_large_model",
        }
    with lease.open_session() as session:
        ifc_file = session.ifc_file
        try:
            element = ifc_file.by_id(express_id)
        except (RuntimeError, LookupError):
            return {**record, "geometry": None, "geometryStatus": "unavailable"}
        unit_scale = ifcopenshell.util.unit.calculate_unit_scale(ifc_file)
        geometry = build_geometry(element, unit_scale)
    return {
        **record,
        "geometry": geometry,
        "geometryStatus": "included" if geometry is not None else "unavailable",
    }


def extract_element(lease: model_runtime.ModelLease, global_id: str) -> dict:
    record = lease.index.record_by_global_id(global_id)
    express_id = int(record["expressId"])
    return _with_geometry(lease, record, express_id)


def extract_element_by_express_id(
    lease: model_runtime.ModelLease,
    express_id: int,
) -> dict:
    record = lease.index.record_by_express_id(express_id)
    return _with_geometry(lease, record, express_id)


_build_geometry = build_geometry
