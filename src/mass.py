"""Take-off decisions over gathered IFC facts.

Facts come from :mod:`mass_facts`. This module ranks candidates, reports
absence or ambiguity, resolves a representative mass, and accumulates totals.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import pi
from re import IGNORECASE, compile as compile_pattern
from typing import Iterable, Literal, Mapping, Sequence, TypeAlias

from content_hash import mapping_digest
from ifc_units import lengths_to_m, mass_to_kilograms
from mass_facts import (
    AssemblyFacts,
    AuthoredWeightFacts,
    MassMeasureFact,
    MeshFacts,
    PartFacts,
    UnitFacts,
    gather_assembly_facts,
    gather_authored_weight_facts,
    gather_mesh_facts,
    gather_part_facts,
    gather_project_units,
)

__all__ = [
    "Absent",
    "Ambiguous",
    "AssemblyFacts",
    "AuthoredWeightFacts",
    "DensityTable",
    "Evidence",
    "MASS_METHODS",
    "MassMeasureFact",
    "MassMethod",
    "MassPolicy",
    "MassRow",
    "MassValue",
    "MeshFacts",
    "MethodComparison",
    "PartFacts",
    "Total",
    "Totals",
    "UnitFacts",
    "Value",
    "accumulate_totals",
    "authored_weight_candidate",
    "compare_methods",
    "gather_assembly_facts",
    "gather_authored_weight_facts",
    "gather_mesh_facts",
    "gather_part_facts",
    "gather_project_units",
    "mesh_candidate",
    "resolve_assembly",
    "resolve_assembly_with_policy",
    "resolve_candidates",
    "section_candidate",
]

MassMethod: TypeAlias = Literal[
    "authored_weight", "density_x_mesh_volume", "density_x_section_volume"
]
AbsenceReason: TypeAlias = Literal[
    "density_missing",
    "unit_unresolved",
    "no_mesh",
    "no_section",
    "no_authored_weight",
    "partial_assembly_selection",
]
MassValue: TypeAlias = "Value | Absent | Ambiguous"

MASS_METHODS: tuple[MassMethod, ...] = (
    "authored_weight",
    "density_x_mesh_volume",
    "density_x_section_volume",
)
DEFAULT_EXCLUDED_ASSEMBLY_NAMES = frozenset({"DUMMY", "TOA DO MOC", "LAYOUT_POINT"})


@dataclass(frozen=True)
class Evidence:
    method: MassMethod
    source_entity_ids: tuple[int, ...]
    entity_kind: str
    measure_type: str
    unit_resolution: str
    density_kg_per_m3: float | None = None
    density_table_revision: str | None = None
    volume_m3: float | None = None
    section_area_m2: float | None = None
    section_length_m: float | None = None
    components: tuple["Evidence", ...] = ()


@dataclass(frozen=True)
class Value:
    kg: float
    evidence: Evidence


@dataclass(frozen=True)
class Absent:
    reason: AbsenceReason
    detail: str | None = None


@dataclass(frozen=True)
class Ambiguous:
    reason: str


@dataclass(frozen=True)
class DensityTable:
    revision: str
    kg_per_m3: Mapping[str, float]

    @property
    def digest(self) -> str:
        return mapping_digest(self.kg_per_m3)


@dataclass(frozen=True)
class MassPolicy:
    """Business rules that choose, compare, and exclude assembly masses."""

    disagreement_tolerance: float = 0.05
    excluded_assembly_names: frozenset[str] = DEFAULT_EXCLUDED_ASSEMBLY_NAMES

    def __post_init__(self) -> None:
        if not 0.0 < self.disagreement_tolerance < 1.0:
            raise ValueError("disagreement tolerance must be between 0 and 1")
        object.__setattr__(
            self,
            "excluded_assembly_names",
            frozenset(name.upper() for name in self.excluded_assembly_names),
        )

    def excludes(self, assembly_name: str | None) -> bool:
        return str(assembly_name or "").upper() in self.excluded_assembly_names


@dataclass(frozen=True)
class MassRow:
    model_hash: str
    assembly_global_id: str
    authored_weight: MassValue
    density_x_mesh_volume: MassValue
    density_x_section_volume: MassValue
    resolved: MassValue
    disagreement: bool
    disagreement_percent: float
    excluded: bool


@dataclass(frozen=True)
class Total:
    sum_kg: float
    n_counted: int
    n_missing: int
    n_ambiguous: int
    n_excluded: int
    n_disagreement: int
    composition: Mapping[MassMethod, float]


@dataclass(frozen=True)
class Totals:
    authored_weight: Total
    density_x_mesh_volume: Total
    density_x_section_volume: Total
    resolved: Total


@dataclass(frozen=True)
class MethodComparison:
    left_method: MassMethod
    right_method: MassMethod
    intersection_count: int
    left_sum_kg: float
    right_sum_kg: float
    percent_difference: float | None


_NUM = r"\d+(?:\.\d+)?"
_SEP = r"\s*[X*]\s*"
_CHS = compile_pattern(rf"^(?:CHS|PIPE)\s*(?P<d>{_NUM}){_SEP}(?P<t>{_NUM})$", IGNORECASE)
_H_SECTION = compile_pattern(
    rf"^(?:BH|H)-?\s*(?P<h>{_NUM}){_SEP}(?P<b>{_NUM}){_SEP}(?P<tw>{_NUM}){_SEP}(?P<tf>{_NUM})$",
    IGNORECASE,
)
_PLATE = compile_pattern(rf"^(?:PLT|PL)\s*(?P<t>{_NUM}){_SEP}(?P<w>{_NUM})$", IGNORECASE)


def _authored_candidate(measures: Sequence[MassMeasureFact]) -> MassValue:
    if any(measure.mass_scale_to_grams is None for measure in measures):
        return Absent("unit_unresolved")
    kilograms = tuple(
        mass_to_kilograms(measure.raw_value, float(measure.mass_scale_to_grams))
        for measure in measures
    )
    if len({round(value, 12) for value in kilograms}) != 1:
        return Ambiguous("conflicting_authored_weight")
    kinds = {measure.entity_kind for measure in measures}
    types = {measure.measure_type for measure in measures}
    resolutions = {measure.unit_resolution for measure in measures}
    evidence = Evidence(
        "authored_weight",
        tuple(measure.source_entity_id for measure in measures),
        "/".join(sorted(kinds)),
        "/".join(sorted(types)),
        next(iter(resolutions)) if len(resolutions) == 1 else "mixed_mass_units",
    )
    return Value(kilograms[0], evidence)


def authored_weight_candidate(facts: AuthoredWeightFacts) -> MassValue:
    if facts.has_quantity_weight:
        if facts.invalid_quantity_source_ids or not facts.quantity_weights:
            return Absent("unit_unresolved")
        return _authored_candidate(facts.quantity_weights)
    if facts.property_weights:
        if facts.invalid_property_source_ids:
            return Absent("unit_unresolved")
        return _authored_candidate(facts.property_weights)
    if facts.invalid_property_source_ids:
        return Absent("unit_unresolved")
    return Absent("no_authored_weight")


def _section_area_m2(text: str | None, length_scale: float) -> float | None:
    if text is None:
        return None
    match = _CHS.fullmatch(text.strip())
    if match is not None:
        diameter, thickness = lengths_to_m(
            [float(match["d"]), float(match["t"])], length_scale
        )
        if 0.0 < 2.0 * thickness < diameter:
            return pi * (diameter**2 - (diameter - 2.0 * thickness) ** 2) / 4.0
        return None
    match = _H_SECTION.fullmatch(text.strip())
    if match is not None:
        height, width, web, flange = lengths_to_m(
            [float(match[name]) for name in ("h", "b", "tw", "tf")],
            length_scale,
        )
        if height > 2.0 * flange and min(width, web, flange) > 0.0:
            return 2.0 * width * flange + (height - 2.0 * flange) * web
        return None
    match = _PLATE.fullmatch(text.strip())
    if match is None:
        return None
    thickness, width = lengths_to_m(
        [float(match["t"]), float(match["w"])], length_scale
    )
    return thickness * width if thickness > 0.0 and width > 0.0 else None


def _density(part: PartFacts, table: DensityTable) -> float | None:
    return table.kg_per_m3.get(part.material_name) if part.material_name is not None else None


def _missing_density(part: PartFacts) -> Absent:
    return Absent("density_missing", part.material_name or "(part carries no material)")


def mesh_candidate(part: PartFacts, table: DensityTable) -> MassValue:
    if part.length_m_per_project_unit is None:
        return Absent("unit_unresolved")
    if part.mesh.volume_m3 is None:
        detail = ", ".join(part.mesh.unsupported_item_types) or None
        return Absent("no_mesh", detail)
    density = _density(part, table)
    if density is None:
        return _missing_density(part)
    evidence = Evidence(
        "density_x_mesh_volume",
        (part.entity_id, *part.mesh.source_entity_ids, *part.material_source_entity_ids),
        part.ifc_type,
        "IfcClosedShell",
        "project_length_unit",
        density,
        table.revision,
        part.mesh.volume_m3,
    )
    return Value(density * part.mesh.volume_m3, evidence)


def section_candidate(part: PartFacts, table: DensityTable) -> MassValue:
    if part.length_m_per_project_unit is None:
        return Absent("unit_unresolved")
    area = _section_area_m2(part.object_type, part.length_m_per_project_unit)
    if area is None:
        return Absent("no_section", part.object_type or "(part carries no section text)")
    if part.mesh.length_m is None:
        return Absent(
            "no_section",
            f"{part.object_type} parsed, but the part has no mesh to take a length from",
        )
    density = _density(part, table)
    if density is None:
        return _missing_density(part)
    volume = area * part.mesh.length_m
    evidence = Evidence(
        "density_x_section_volume",
        (part.entity_id, *part.material_source_entity_ids),
        part.ifc_type,
        "ObjectType section text",
        "project_length_unit",
        density,
        table.revision,
        volume,
        area,
        part.mesh.length_m,
    )
    return Value(density * volume, evidence)


_MAX_NAMED_CAUSES = 6


def _rolled_up_absence(absences: Sequence[Absent]) -> Absent:
    reason = absences[0].reason
    causes = sorted(
        {absent.detail for absent in absences if absent.reason == reason and absent.detail}
    )
    if not causes:
        return Absent(reason)
    shown = ", ".join(causes[:_MAX_NAMED_CAUSES])
    hidden = len(causes) - _MAX_NAMED_CAUSES
    return Absent(reason, f"{shown} and {hidden} more" if hidden > 0 else shown)


def _roll_up(values: Sequence[MassValue], method: MassMethod) -> MassValue:
    if not values:
        return Absent("no_mesh" if method == "density_x_mesh_volume" else "no_section")
    ambiguous = tuple(value for value in values if isinstance(value, Ambiguous))
    if ambiguous:
        return ambiguous[0]
    absences = tuple(value for value in values if isinstance(value, Absent))
    if absences:
        return _rolled_up_absence(absences)
    present = tuple(value for value in values if isinstance(value, Value))
    evidence = Evidence(
        method,
        tuple(
            sorted(
                {
                    entity_id
                    for value in present
                    for entity_id in value.evidence.source_entity_ids
                }
            )
        ),
        "IfcElementAssembly",
        "sum_of_parts",
        "derived_from_components",
        components=tuple(value.evidence for value in present),
    )
    return Value(sum(value.kg for value in present), evidence)


def resolve_candidates(candidates: Mapping[MassMethod, MassValue]) -> MassValue:
    for method in MASS_METHODS:
        candidate = candidates[method]
        if isinstance(candidate, Ambiguous | Value):
            return candidate
    return candidates["authored_weight"]


def _disagreement_percent(candidates: Mapping[MassMethod, MassValue]) -> float:
    values = tuple(
        candidate.kg for candidate in candidates.values() if isinstance(candidate, Value)
    )
    maximum = 0.0
    for index, left in enumerate(values):
        for right in values[index + 1 :]:
            denominator = max(abs(left), abs(right))
            if denominator <= 0.0:
                continue
            maximum = max(maximum, abs(left - right) * 100.0 / denominator)
    return maximum


def _partial_selection(facts: AssemblyFacts) -> bool:
    return facts.selected_part_ids is not None and set(facts.selected_part_ids) != {
        part.entity_id for part in facts.parts
    }


def resolve_assembly(
    facts: AssemblyFacts,
    density_table: DensityTable,
    tolerance: float = 0.05,
    exclusion_names=DEFAULT_EXCLUDED_ASSEMBLY_NAMES,
) -> MassRow:
    return resolve_assembly_with_policy(
        facts,
        density_table,
        MassPolicy(tolerance, frozenset(exclusion_names)),
    )


def resolve_assembly_with_policy(
    facts: AssemblyFacts,
    density_table: DensityTable,
    policy: MassPolicy,
) -> MassRow:
    authored = authored_weight_candidate(facts.authored_weight)
    if _partial_selection(facts):
        selected = len(set(facts.selected_part_ids or ()) & {part.entity_id for part in facts.parts})
        partial = Absent(
            "partial_assembly_selection",
            f"{selected} of {len(facts.parts)} parts of this assembly are selected",
        )
        return MassRow(
            facts.model_hash,
            facts.assembly_global_id,
            authored,
            partial,
            partial,
            partial,
            False,
            0.0,
            False,
        )
    mesh = _roll_up(
        tuple(mesh_candidate(part, density_table) for part in facts.parts),
        "density_x_mesh_volume",
    )
    section = _roll_up(
        tuple(section_candidate(part, density_table) for part in facts.parts),
        "density_x_section_volume",
    )
    candidates = {
        "authored_weight": authored,
        "density_x_mesh_volume": mesh,
        "density_x_section_volume": section,
    }
    disagreement_percent = _disagreement_percent(candidates)
    excluded = policy.excludes(facts.name)
    return MassRow(
        facts.model_hash,
        facts.assembly_global_id,
        authored,
        mesh,
        section,
        resolve_candidates(candidates),
        disagreement_percent > policy.disagreement_tolerance * 100.0,
        disagreement_percent,
        excluded,
    )


def _row_value(row: MassRow, method: MassMethod | None) -> MassValue:
    return row.resolved if method is None else getattr(row, method)


def _total(rows: Iterable[MassRow], method: MassMethod | None) -> Total:
    sum_kg = 0.0
    counted = missing = ambiguous = excluded = disagreements = 0
    amounts = {candidate: 0.0 for candidate in MASS_METHODS}
    seen = set()
    for row in rows:
        key = (row.model_hash, row.assembly_global_id)
        if key in seen:
            continue
        seen.add(key)
        if row.excluded:
            excluded += 1
            continue
        if row.disagreement:
            disagreements += 1
        if (
            isinstance(row.resolved, Absent)
            and row.resolved.reason == "partial_assembly_selection"
        ):
            missing += 1
            continue
        value = _row_value(row, method)
        if isinstance(value, Value):
            sum_kg += value.kg
            counted += 1
            amounts[value.evidence.method] += value.kg
        elif isinstance(value, Ambiguous):
            ambiguous += 1
        else:
            missing += 1
    composition = (
        {candidate: amount / sum_kg for candidate, amount in amounts.items()}
        if sum_kg != 0.0
        else {}
    )
    return Total(
        sum_kg,
        counted,
        missing,
        ambiguous,
        excluded,
        disagreements,
        composition,
    )


def accumulate_totals(rows: Iterable[MassRow]) -> Totals:
    materialized = tuple(rows)
    return Totals(
        _total(materialized, "authored_weight"),
        _total(materialized, "density_x_mesh_volume"),
        _total(materialized, "density_x_section_volume"),
        _total(materialized, None),
    )


def compare_methods(
    rows: Iterable[MassRow], left: MassMethod, right: MassMethod
) -> MethodComparison:
    left_sum = right_sum = 0.0
    intersection = 0
    seen = set()
    for row in rows:
        key = (row.model_hash, row.assembly_global_id)
        if key in seen or row.excluded:
            continue
        seen.add(key)
        left_value, right_value = _row_value(row, left), _row_value(row, right)
        if not isinstance(left_value, Value) or not isinstance(right_value, Value):
            continue
        left_sum += left_value.kg
        right_sum += right_value.kg
        intersection += 1
    percent = (
        abs(left_sum - right_sum) * 100.0 / abs(left_sum)
        if intersection and left_sum != 0.0
        else None
    )
    return MethodComparison(left, right, intersection, left_sum, right_sum, percent)
