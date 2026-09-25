"""Model use cases shared by HTTP and future desktop adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, BinaryIO

from ifc_elements import (
    extract_element,
    extract_element_by_express_id,
)
from model_cache import cached_model_file
import model_cache
import model_runtime
import model_transactions
from model_runtime import (
    cancel_active_load,
    lease_active_model,
    live_model_status,
    materialize_model_stream,
    open_model_session,
    register_model,
)
from model_limits import require_supported_ifc_size
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
    *, store_only: bool = False,
) -> MaterializedModel:
    info = (materialize_model_stream(reader, original_filename, True, activate=False)
            if store_only else materialize_model_stream(reader, original_filename, True))
    return MaterializedModel(
        model_hash=info["contentHashSha256"],
        original_filename=info["originalFilename"],
        size_bytes=info["sizeBytes"],
    )


def materialize_local_model(path: str) -> MaterializedModel:
    """Copy a desktop-picked IFC directly into the managed cache."""
    from pathlib import Path

    source = Path(path)
    require_supported_ifc_size(source.stat().st_size)
    with source.open("rb") as reader:
        info = materialize_model_stream(reader, source.name, True, activate=False)
    return MaterializedModel(
        model_hash=info["contentHashSha256"],
        original_filename=info["originalFilename"],
        size_bytes=info["sizeBytes"],
    )


def activate_cached_model(model_hash: str) -> dict[str, Any]:
    path = cached_model_file(model_hash)
    return register_model(str(path), model_hash, True)


def cached_model_source(model_hash: str):
    return cached_model_file(model_hash)


def register_external_model(path: str, expected_hash: str) -> dict[str, Any]:
    return register_model(path, expected_hash, True)


def runtime_status() -> dict[str, Any]:
    return live_model_status()


def prepare_stage(stage_id: str, model_hash: str, filename: str | None) -> dict:
    return model_transactions.prepare(stage_id, model_hash, filename)


def transition_stage(stage_id: str, action: str, semantic_mode: str | None = None) -> dict:
    return model_transactions.transition(stage_id, action, semantic_mode)


def cached_storage(scope: str | None = None) -> dict:
    model = model_runtime._state.get_or_none()
    active_hash = model.contentHashSha256 if model else None
    return model_cache.cache_inventory(active_hash) if scope is None else model_cache.clear_cache(scope, active_hash)


def model_tree() -> dict[str, Any]:
    with lease_active_model() as lease:
        return get_model_tree(lease.index)


def search_active_model(
    query: str | None,
    ifc_type: str | None,
    limit: int,
) -> dict[str, Any]:
    with lease_active_model() as lease:
        return search_model(q=query, ifc_type=ifc_type, limit=limit, index=lease.index)


def element_by_express_id(express_id: int) -> dict[str, Any]:
    with lease_active_model() as lease:
        return extract_element_by_express_id(lease, express_id)


def element_by_global_id(global_id: str) -> dict[str, Any]:
    with lease_active_model() as lease:
        return extract_element(lease, global_id)


def element_records(local_ids: list[int], global_ids: list[str]) -> dict[str, Any]:
    if len(local_ids) + len(global_ids) > 500:
        raise ValueError("too_many_element_ids")
    with lease_active_model() as lease:
        local = lease.index.records_by_express_ids(local_ids)
        global_ = lease.index.records_by_global_ids(global_ids)
        return {
            "localIds": local_ids,
            "globalIds": global_ids,
            "byLocalId": [local.get(value) for value in local_ids],
            "byGlobalId": [global_.get(value) for value in global_ids],
        }


def active_model_materials() -> tuple[MaterialUse, ...]:
    with open_model_session() as session:
        return survey_materials(session.ifc_file)
