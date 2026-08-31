"""Turn a viewer selection into the nine geometry columns used by GetComList."""

from __future__ import annotations

from dataclasses import dataclass
from math import asin, atan2, degrees
from typing import Any, Sequence

import ifcopenshell

import mass_facts
import member_axis
from model_runtime import locate_live_element, open_active_model

IDEA_SCHEMA_VERSION = 1
MEMBER_TYPES = ("IfcBeam", "IfcColumn", "IfcMember")
_MIN_SLENDERNESS = 2.0
_NODE_TOLERANCE_M = 0.05
_COLUMNS = (
    "Frame",
    "Start Point",
    "End Point",
    "Length",
    "Direction Vector",
    "Direction Angle",
    "Pitch Angle",
    "Angle",
    "Section",
)
_UNIT_SCALE = {"m": 1.0, "mm": 1000.0}


@dataclass(frozen=True)
class Skipped:
    global_id: str
    name: str
    reason: str
    detail: str


@dataclass(frozen=True)
class Scan:
    rows: tuple[tuple[Any, ...], ...]
    skipped: tuple[Skipped, ...]
    joint_node: str
    length_unit: str


def _member_name(product) -> str:
    for attribute in ("Name", "Tag"):
        value = getattr(product, attribute, None)
        if value:
            return str(value)
    return product.GlobalId


def _section_name(
    product, project_scale: float, near: Sequence[float], far: Sequence[float]
) -> str:
    swept = member_axis.tapered_profiles(product, project_scale)
    if swept is not None:
        sweep_start, first, last = swept
        if first or last:
            to_near = sum((a - b) ** 2 for a, b in zip(sweep_start, near))
            to_far = sum((a - b) ** 2 for a, b in zip(sweep_start, far))
            if to_near <= to_far:
                return first
            return last or first
    for relation in getattr(product, "IsDefinedBy", None) or ():
        if not relation.is_a("IfcRelDefinesByProperties"):
            continue
        definition = relation.RelatingPropertyDefinition
        for property_ in getattr(definition, "HasProperties", None) or ():
            if property_.Name not in ("Profile", "ProfileName", "Section", "PROFILE"):
                continue
            if not getattr(property_, "NominalValue", None):
                continue
            return str(property_.NominalValue.wrappedValue)
    material = getattr(product, "HasAssociations", None) or ()
    for association in material:
        if not association.is_a("IfcRelAssociatesMaterial"):
            continue
        profile = getattr(association.RelatingMaterial, "Name", None)
        if profile:
            return str(profile)
    return ""


class _Nodes:
    def __init__(self, tolerance: float):
        self._tolerance = tolerance
        self._points = []

    def name_for(self, point: Sequence[float]) -> str:
        for index, known in enumerate(self._points):
            if sum((a - b) ** 2 for a, b in zip(known, point)) <= self._tolerance**2:
                return f"N{index + 1}"
        self._points.append((float(point[0]), float(point[1]), float(point[2])))
        return f"N{len(self._points)}"


def _oriented(axis: member_axis.MemberAxis, joint: Sequence[float]):
    to_start = sum((a - b) ** 2 for a, b in zip(axis.start, joint))
    to_end = sum((a - b) ** 2 for a, b in zip(axis.end, joint))
    near, far = (axis.start, axis.end) if to_start <= to_end else (axis.end, axis.start)
    direction = tuple((f - n) / axis.length_m for n, f in zip(near, far))
    return near, far, direction


def _azimuth_degrees(x: float, y: float) -> float:
    if abs(x) < 1e-7 and abs(y) < 1e-7:
        return 0.0
    return round(degrees(atan2(y, x)), 3)


def _clean(value: float) -> float:
    return round(value, 3) + 0.0


def _row(
    product,
    axis: member_axis.MemberAxis,
    joint: Sequence[float],
    nodes: _Nodes,
    scale: float,
    project_scale: float,
):
    near, far, direction = _oriented(axis, joint)
    x, y, z = (_clean(value) for value in direction)
    return (
        _member_name(product),
        nodes.name_for(near),
        nodes.name_for(far),
        round(axis.length_m * scale, 3),
        f"{x} {y} {z}",
        _azimuth_degrees(x, y),
        round(degrees(asin(max(-1.0, min(1.0, z)))), 3),
        "" if axis.roll_deg is None else axis.roll_deg,
        _section_name(product, project_scale, near, far),
    )


def scan(
    global_ids: Sequence[str], joint: Sequence[float], length_unit: str
) -> Scan:
    if length_unit not in _UNIT_SCALE:
        raise ValueError(f"length_unit must be one of {sorted(_UNIT_SCALE)}")
    model = open_active_model()
    scale = _UNIT_SCALE[length_unit]
    project_scale = mass_facts.gather_project_units(
        model
    ).length_m_per_project_unit
    nodes = _Nodes(_NODE_TOLERANCE_M)
    nodes.name_for(joint)
    rows = []
    skipped = []
    for global_id in global_ids:
        outcome = _row_or_skip(
            locate_live_element(model, global_id),
            joint,
            nodes,
            scale,
            project_scale,
        )
        if isinstance(outcome, Skipped):
            skipped.append(outcome)
        else:
            rows.append(outcome)
    return Scan(tuple(rows), tuple(skipped), "N1", length_unit)


def _row_or_skip(
    product,
    joint: Sequence[float],
    nodes: _Nodes,
    scale: float,
    project_scale: float | None,
):
    name = _member_name(product)
    if not any(product.is_a(kind) for kind in MEMBER_TYPES):
        return Skipped(
            product.GlobalId,
            name,
            "not_a_member",
            f"{product.is_a()} - IDEA takes members, not plates or fasteners",
        )
    if project_scale is None:
        return Skipped(
            product.GlobalId,
            name,
            "no_length_unit",
            "the model declares no length unit",
        )
    axis = member_axis.member_axis(product, project_scale)
    if isinstance(axis, member_axis.AxisAbsent):
        return Skipped(product.GlobalId, name, axis.reason, axis.detail)
    if axis.slenderness < _MIN_SLENDERNESS:
        return Skipped(
            product.GlobalId,
            name,
            "not_slender",
            f"length is {axis.slenderness:.2f} of its own width - a fitting, not a member",
        )
    return _row(product, axis, joint, nodes, scale, project_scale)


def blank_sections(result: Scan) -> tuple[str, ...]:
    return tuple(str(row[0]) for row in result.rows if not row[8])


def scan_tsv(result: Scan) -> str:
    return "\n".join(
        "\t".join(str(cell) for cell in row) for row in (_COLUMNS,) + result.rows
    )


def scan_wire(result: Scan) -> dict[str, Any]:
    return {
        "schemaVersion": IDEA_SCHEMA_VERSION,
        "columns": list(_COLUMNS),
        "lengthUnit": result.length_unit,
        "jointNode": result.joint_node,
        "blankSections": list(blank_sections(result)),
        "rows": [list(row) for row in result.rows],
        "skipped": [
            {
                "globalId": item.global_id,
                "name": item.name,
                "reason": item.reason,
                "detail": item.detail,
            }
            for item in result.skipped
        ],
    }


GETCOMLIST_HEADER = _COLUMNS
