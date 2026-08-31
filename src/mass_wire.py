"""Serialize mass-domain values without adding transport concerns to policy code."""

from __future__ import annotations

from mass import Absent, Ambiguous, Evidence, MassValue, Value


def evidence_wire(evidence: Evidence) -> dict:
    inputs = {}
    if evidence.density_kg_per_m3 is not None:
        inputs["density"] = {
            "value": evidence.density_kg_per_m3,
            "units": {"density": "kg/m3"},
        }
    if evidence.volume_m3 is not None:
        inputs["volume"] = {
            "value": evidence.volume_m3,
            "units": {"volume": "m3"},
        }
    if evidence.section_area_m2 is not None:
        inputs["sectionArea"] = {
            "value": evidence.section_area_m2,
            "units": {"area": "m2"},
        }
    if evidence.section_length_m is not None:
        inputs["sectionLength"] = {
            "value": evidence.section_length_m,
            "units": {"length": "m"},
        }
    return {
        "method": evidence.method,
        "sourceEntityIds": list(evidence.source_entity_ids),
        "entityKind": evidence.entity_kind,
        "measureType": evidence.measure_type,
        "unitResolution": evidence.unit_resolution,
        "densityTableRevision": evidence.density_table_revision,
        "inputs": inputs,
        "components": [evidence_wire(component) for component in evidence.components],
    }


def mass_value_wire(value: MassValue) -> dict:
    if isinstance(value, Value):
        return {
            "status": "value",
            "kg": value.kg,
            "units": {"mass": "kg"},
            "evidence": evidence_wire(value.evidence),
        }
    if isinstance(value, Absent):
        return {"status": "unavailable", "reason": value.reason, "detail": value.detail}
    if isinstance(value, Ambiguous):
        return {"status": "ambiguous", "reason": value.reason, "detail": None}
    raise TypeError(f"unsupported mass value: {type(value).__name__}")
