"""Load the generic handbook material-density reference shipped with the app."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from content_hash import mapping_digest

MATERIAL_REFERENCE_SCHEMA_VERSION = 3


def _resource_path(*parts: str) -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass).joinpath(*parts)
    return Path(__file__).resolve().parents[1].joinpath(*parts)


def _material(data: object) -> dict | None:
    if not isinstance(data, dict):
        return None
    name = data.get("material")
    density = data.get("kgPerM3")
    note = data.get("note")
    if not isinstance(name, str) or not isinstance(note, str):
        return None
    if (
        not isinstance(density, (int, float))
        or isinstance(density, bool)
        or density <= 0.0
    ):
        return None
    return {"material": name, "kgPerM3": float(density), "note": note}


def _reference_entry(data: object) -> dict | None:
    if (
        not isinstance(data, dict)
        or data.get("schemaVersion") != MATERIAL_REFERENCE_SCHEMA_VERSION
    ):
        return None
    revision = data.get("revision")
    declared_approval = data.get("declaredApproval")
    label = data.get("label")
    note = data.get("note")
    entries = data.get("materials")
    if not isinstance(revision, str) or not isinstance(declared_approval, str):
        return None
    if not isinstance(label, str) or not isinstance(note, str) or not isinstance(entries, list):
        return None

    materials = []
    for entry in entries:
        material = _material(entry)
        if material is None:
            return None
        materials.append(material)
    if not materials:
        return None

    return {
        "revision": revision,
        "declaredApproval": declared_approval,
        "digest": mapping_digest(
            {material["material"]: material["kgPerM3"] for material in materials}
        ),
        "label": label,
        "note": note,
        "materials": materials,
    }


def load_material_reference() -> list[dict]:
    directory = _resource_path("backend", "reference_data")
    if not directory.is_dir():
        return []
    try:
        paths = list(directory.glob("*.json"))
    except OSError:
        return []

    references = []
    for path in paths:
        try:
            entry = _reference_entry(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if entry is None:
            continue
        references.append(entry)
    return sorted(references, key=lambda reference: reference["revision"])
