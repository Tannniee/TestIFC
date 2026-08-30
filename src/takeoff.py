"""Take-off orchestration over the active model.

Policy lives in :mod:`mass`, traversal in :mod:`mass_facts`. This module maps
selected entities to take-off subjects, assembles rows, and serializes them.
"""

from __future__ import annotations

from csv import writer as csv_writer
from io import StringIO
from typing import Any, Callable, Sequence

import ifcopenshell

import mass
import mass_facts
import member_axis
from ifc_service import get_active_model_info, locate_live_element, open_active_model

TAKEOFF_SCHEMA_VERSION = 5
_METHODS = mass.MASS_METHODS
_COMPARISONS = (
    ("authored_weight", "density_x_mesh_volume"),
    ("authored_weight", "density_x_section_volume"),
)


class UnknownElementError(LookupError):
    """A requested GlobalId is not present in the active model."""


def _element(ifc_file: ifcopenshell.file, global_id: str):
    try:
        return locate_live_element(ifc_file, global_id)
    except (LookupError, RuntimeError) as error:
        raise UnknownElementError(global_id) from error


def _group_selection(ifc_file, global_ids: Sequence[str]):
    subjects = {}
    parts_by_subject = {}
    whole = set()
    picked = []
    for global_id in global_ids:
        element = _element(ifc_file, global_id)
        picked.append(element)
        subject = mass_facts.takeoff_subject(element)
        subjects[subject.id()] = subject
        if subject.id() == element.id():
            whole.add(subject.id())
            continue
        parts_by_subject.setdefault(subject.id(), set()).add(element.id())
    selected = {
        subject_id: None
        if subject_id in whole
        else parts_by_subject.get(subject_id, set())
        for subject_id in subjects
    }
    return subjects, selected, picked


def _selected_wire(element, subject, units, table):
    part = mass_facts.gather_part_facts(element, units)
    return {
        "globalId": element.GlobalId,
        "expressId": element.id(),
        "ifcType": element.is_a(),
        "name": getattr(element, "Name", None),
        "objectType": getattr(element, "ObjectType", None),
        "takeoffSubjectGlobalId": subject.GlobalId,
        "isTakeoffSubject": subject.id() == element.id(),
        "densityXMeshVolume": mass.mass_value_wire(mass.mesh_candidate(part, table)),
        "densityXSectionVolume": mass.mass_value_wire(
            mass.section_candidate(part, table)
        ),
    }


def _section_label(subject, length_scale: float | None) -> str:
    if length_scale is None:
        return ""
    profiles = member_axis.tapered_profiles(subject, length_scale)
    if profiles is None:
        return ""
    _, first, last = profiles
    if first == last or not last:
        return first
    return _tapered_label(first, last)


def _tapered_label(first: str, last: str) -> str:
    prefix = 0
    while prefix < min(len(first), len(last)) and first[prefix] == last[prefix]:
        prefix += 1
    suffix = 0
    while (
        suffix < min(len(first), len(last)) - prefix
        and first[-1 - suffix] == last[-1 - suffix]
    ):
        suffix += 1
    while prefix > 0 and first[prefix - 1].isdigit():
        prefix -= 1
    while suffix > 0 and first[len(first) - suffix].isdigit():
        suffix -= 1
    varying_first = first[prefix : len(first) - suffix]
    varying_last = last[prefix : len(last) - suffix]
    if not varying_first or not varying_last or (prefix == 0 and suffix == 0):
        return f"{first} -> {last}"
    return (
        f"{first[:prefix]}({varying_first}~{varying_last})"
        f"{first[len(first) - suffix:]}"
    )


def _length_m(facts: mass_facts.AssemblyFacts):
    lengths = [
        part.mesh.length_m
        for part in facts.parts
        if part.mesh.length_m is not None
    ]
    return round(max(lengths), 3) if lengths else ""


def _row_wire(row: mass.MassRow, subject, length_scale, facts):
    return {
        "globalId": row.assembly_global_id,
        "expressId": subject.id(),
        "ifcType": subject.is_a(),
        "name": getattr(subject, "Name", None),
        "section": _section_label(subject, length_scale),
        "lengthM": _length_m(facts),
        "authoredWeight": mass.mass_value_wire(row.authored_weight),
        "densityXMeshVolume": mass.mass_value_wire(row.density_x_mesh_volume),
        "densityXSectionVolume": mass.mass_value_wire(
            row.density_x_section_volume
        ),
        "resolved": mass.mass_value_wire(row.resolved),
        "resolvedMethod": (
            row.resolved.evidence.method if isinstance(row.resolved, mass.Value) else None
        ),
        "disagreement": row.disagreement,
        "disagreementPercent": row.disagreement_percent,
        "excluded": row.excluded,
    }


def _total_wire(total: mass.Total):
    counted = total.n_counted > 0
    return {
        "status": "value" if counted else "unavailable",
        "sumKg": total.sum_kg if counted else None,
        "units": {"mass": "kg"},
        "nCounted": total.n_counted,
        "nMissing": total.n_missing,
        "nAmbiguous": total.n_ambiguous,
        "nExcluded": total.n_excluded,
        "nDisagreement": total.n_disagreement,
        "composition": dict(total.composition),
    }


def model_subject_ids() -> list[str]:
    seen = {}
    for element in open_active_model().by_type("IfcElement"):
        subject = mass_facts.takeoff_subject(element)
        seen.setdefault(subject.id(), subject.GlobalId)
    return list(seen.values())


def takeoff(
    global_ids: Sequence[str],
    table: mass.DensityTable,
    tolerance: float = 0.05,
    on_progress: Callable[[int, int], Any] | None = None,
) -> dict[str, Any]:
    ifc_file = open_active_model()
    info = get_active_model_info()
    model_hash = str(info["contentHashSha256"])
    units = mass_facts.gather_project_units(ifc_file)
    subjects, selected_parts, picked = _group_selection(ifc_file, global_ids)
    rows = []
    row_wires = []
    for done, (subject_id, subject) in enumerate(subjects.items(), start=1):
        chosen = selected_parts[subject_id]
        facts = mass_facts.gather_assembly_facts(
            ifc_file,
            subject,
            model_hash,
            sorted(chosen) if chosen is not None else None,
        )
        row = mass.resolve_assembly(facts, table, tolerance)
        rows.append(row)
        row_wires.append(
            _row_wire(row, subject, units.length_m_per_project_unit, facts)
        )
        if on_progress is not None:
            on_progress(done, len(subjects))
    totals = mass.accumulate_totals(rows)
    comparisons = []
    for left, right in _COMPARISONS:
        comparison = mass.compare_methods(rows, left, right)
        comparisons.append(
            {
                "leftMethod": left,
                "rightMethod": right,
                "intersectionCount": comparison.intersection_count,
                "leftSumKg": comparison.left_sum_kg,
                "rightSumKg": comparison.right_sum_kg,
                "percentDifference": comparison.percent_difference,
            }
        )
    return {
        "schemaVersion": TAKEOFF_SCHEMA_VERSION,
        "modelHash": model_hash,
        "densityTableRevision": table.revision,
        "densityTableDigest": table.digest,
        "densityKgPerM3": dict(table.kg_per_m3),
        "tolerance": tolerance,
        "selection": [
            _selected_wire(
                element,
                mass_facts.takeoff_subject(element),
                units,
                table,
            )
            for element in picked
        ],
        "subjects": row_wires,
        "totals": {
            "authoredWeight": _total_wire(totals.authored_weight),
            "densityXMeshVolume": _total_wire(totals.density_x_mesh_volume),
            "densityXSectionVolume": _total_wire(
                totals.density_x_section_volume
            ),
            "resolved": _total_wire(totals.resolved),
        },
        "comparisons": comparisons,
    }


_CSV_COLUMNS = (
    "globalId",
    "expressId",
    "ifcType",
    "name",
    "section",
    "length_m",
    "authoredWeight_kg",
    "authoredWeight_status",
    "densityXMeshVolume_kg",
    "densityXMeshVolume_status",
    "densityXSectionVolume_kg",
    "densityXSectionVolume_status",
    "resolved_kg",
    "resolved_status",
    "resolvedMethod",
    "disagreementPercent",
    "excluded",
)
TAKEOFF_KG_COLUMNS = tuple(
    index for index, column in enumerate(_CSV_COLUMNS) if column.endswith("_kg")
)


def _cell(wire):
    if wire["status"] == "value":
        return wire["kg"], "value"
    reason = wire.get("reason", wire["status"])
    detail = wire.get("detail")
    return "", f"{reason}: {detail}" if detail else reason


_QUICKVIEW_COLUMNS = (
    "Member",
    "GlobalId",
    "Section",
    "Length (m)",
    "M1 authored WEIGHT (kg)",
    "M2 density x mesh (kg)",
    "M3 density x section (kg)",
    "Resolved (kg)",
    "Method",
)
QUICKVIEW_KG_COLUMNS = (4, 5, 6, 7)


def quickview_rows(result: dict[str, Any]):
    resolved = result["totals"]["resolved"]
    rows = [
        ["Model", result["modelHash"]],
        ["Density basis", result["densityTableRevision"], result["densityTableDigest"]],
        ["Tolerance", result["tolerance"]],
        ["Members", len(result["subjects"])],
        [
            "Total resolved (kg)",
            resolved["sumKg"] if resolved["status"] == "value" else "",
        ],
    ]
    for comparison in result["comparisons"]:
        rows.append(
            [
                f'{comparison["leftMethod"]} vs {comparison["rightMethod"]}',
                comparison["leftSumKg"]
                if comparison["leftSumKg"] is not None
                else "",
                comparison["rightSumKg"]
                if comparison["rightSumKg"] is not None
                else "",
                f'over {comparison["intersectionCount"]} members with both',
                ""
                if comparison["percentDifference"] is None
                else f'{comparison["percentDifference"]}% apart',
            ]
        )
    rows.append([])
    header_index = len(rows)
    rows.append(list(_QUICKVIEW_COLUMNS))
    for row in result["subjects"]:
        rows.append(
            [
                row["name"] or "",
                row["globalId"],
                row["section"],
                row["lengthM"],
                _cell(row["authoredWeight"])[0],
                _cell(row["densityXMeshVolume"])[0],
                _cell(row["densityXSectionVolume"])[0],
                _cell(row["resolved"])[0],
                row["resolvedMethod"] or "",
            ]
        )
    return rows, header_index


def takeoff_rows(result: dict[str, Any]) -> list[list[Any]]:
    rows = [
        ["# takeoffSchemaVersion", result["schemaVersion"]],
        ["# modelHash", result["modelHash"]],
        ["# densityTableRevision", result["densityTableRevision"]],
        ["# densityTableDigest", result["densityTableDigest"]],
        ["# tolerance", result["tolerance"]],
    ]
    rows += [
        ["# density", material, value, "kg/m3"]
        for material, value in sorted(result["densityKgPerM3"].items())
    ]
    for name, total in result["totals"].items():
        sum_cell = "" if total["sumKg"] is None else total["sumKg"]
        rows.append(
            [
                f"# total.{name}",
                sum_cell,
                "kg",
                f'counted={total["nCounted"]}',
                f'missing={total["nMissing"]}',
                f'ambiguous={total["nAmbiguous"]}',
                f'excluded={total["nExcluded"]}',
                f'disagreement={total["nDisagreement"]}',
            ]
        )
    for comparison in result["comparisons"]:
        rows.append(
            [
                f'# compare.{comparison["leftMethod"]}_vs_{comparison["rightMethod"]}',
                comparison["leftSumKg"]
                if comparison["leftSumKg"] is not None
                else "",
                comparison["rightSumKg"]
                if comparison["rightSumKg"] is not None
                else "",
                "kg",
                f'bothPresent={comparison["intersectionCount"]}',
                ""
                if comparison["percentDifference"] is None
                else f'difference={comparison["percentDifference"]}%',
            ]
        )
    rows.append(list(_CSV_COLUMNS))
    for row in result["subjects"]:
        authored_kg, authored_status = _cell(row["authoredWeight"])
        mesh_kg, mesh_status = _cell(row["densityXMeshVolume"])
        section_kg, section_status = _cell(row["densityXSectionVolume"])
        resolved_kg, resolved_status = _cell(row["resolved"])
        rows.append(
            [
                row["globalId"],
                row["expressId"],
                row["ifcType"],
                row["name"] or "",
                row["section"],
                row["lengthM"],
                authored_kg,
                authored_status,
                mesh_kg,
                mesh_status,
                section_kg,
                section_status,
                resolved_kg,
                resolved_status,
                row["resolvedMethod"] or "",
                row["disagreementPercent"],
                row["excluded"],
            ]
        )
    return rows


def takeoff_csv(result: dict[str, Any]) -> str:
    buffer = StringIO(newline="")
    write = csv_writer(buffer, lineterminator="\n").writerow
    for row in takeoff_rows(result):
        write(row)
    return buffer.getvalue()
