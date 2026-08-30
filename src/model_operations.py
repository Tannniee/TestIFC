"""Model use cases shared by HTTP and future desktop adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, BinaryIO

from ifc_service import (
    cached_model_file,
    extract_element,
    extract_element_by_express_id,
    live_model_status,
    materialize_model_stream,
    open_active_model,
    register_model,
)
from mass_facts import MaterialUse, survey_materials
from model_query import get_model_tree, search_model


@dataclass(frozen=True, slots=True)
class MaterializedModel:
    model_hash: str
    original_filename: str | None
    size_bytes: int


def materialize_uploaded_model(
    reader: BinaryIO,
    original_filename: str | None,
) -> MaterializedModel:
    info = materialize_model_stream(reader, original_filename, True)
    return MaterializedModel(
        model_hash=info["contentHashSha256"],
        original_filename=info["originalFilename"],
        size_bytes=info["sizeBytes"],
    )


def activate_cached_model(model_hash: str) -> dict[str, Any]:
    path = cached_model_file(model_hash)
    return register_model(str(path), model_hash, True)


def register_external_model(path: str, expected_hash: str) -> dict[str, Any]:
    return register_model(path, expected_hash, True)


def runtime_status() -> dict[str, Any]:
    return live_model_status()


def model_tree() -> dict[str, Any]:
    return get_model_tree()


def search_active_model(
    query: str | None,
    ifc_type: str | None,
    limit: int,
) -> dict[str, Any]:
    return search_model(q=query, ifc_type=ifc_type, limit=limit)


def element_by_express_id(express_id: int) -> dict[str, Any]:
    return extract_element_by_express_id(express_id)


def element_by_global_id(global_id: str) -> dict[str, Any]:
    return extract_element(global_id)


def active_model_materials() -> tuple[MaterialUse, ...]:
    return survey_materials(open_active_model())
