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
import gis_anchor
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
from mass_facts import MaterialUse, survey_materials
from model_query import get_model_tree, search_model


@dataclass(frozen=True, slots=True)
class MaterializedModel:
    model_hash: str
    original_filename: str | None
    size_bytes: int


class ActiveModelChangedError(ValueError):
    """A query arrived after the viewer switched to another IFC model."""


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


def activate_cached_model(model_hash: str) -> dict[str, Any]:
    path = cached_model_file(model_hash)
    return register_model(str(path), model_hash, True)


def register_external_model(path: str, expected_hash: str) -> dict[str, Any]:
    return register_model(path, expected_hash, True)


def runtime_status() -> dict[str, Any]:
    return live_model_status()


def prepare_stage(stage_id: str, model_hash: str, filename: str | None) -> dict:
    return model_transactions.prepare(stage_id, model_hash, filename)


def transition_stage(stage_id: str, action: str) -> dict:
    return model_transactions.transition(stage_id, action)


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


def bim_element_by_express_id(express_id: int, model_hash: str) -> dict[str, Any]:
    """Read indexed BIM data without opening or triangulating IFC geometry."""
    with lease_active_model() as lease:
        if lease.ref.model_hash != model_hash:
            raise ActiveModelChangedError()
        return {
            "modelHash": model_hash,
            "coldStatus": lease.index.cold_status,
            "element": lease.index.record_by_express_id(express_id),
        }


def model_georeference(model_hash: str) -> dict[str, Any]:
    """Return indexed IFC map metadata bound to the active model hash."""
    with lease_active_model() as lease:
        if lease.ref.model_hash != model_hash:
            raise ActiveModelChangedError()
        return {"modelHash": model_hash, **lease.index.georeference()}


def model_browser(model_hash: str, view: str) -> dict[str, Any]:
    """Return compact indexed elements and memberships for one browser view."""
    with lease_active_model() as lease:
        if lease.ref.model_hash != model_hash:
            raise ActiveModelChangedError()
        return {"modelHash": model_hash, "view": view, **lease.index.browser(view)}


def semantic_search(model_hash: str, kind: str, set_name: str, property_name: str,
                    operator: str, value: str, ifc_type: str, limit: int) -> dict[str, Any]:
    with lease_active_model() as lease:
        if lease.ref.model_hash != model_hash:
            raise ActiveModelChangedError()
        return {"modelHash": model_hash, **lease.index.semantic_search(
            kind, set_name, property_name, operator, value, ifc_type, limit)}


def _require_active_hash(model_hash: str) -> None:
    model = model_runtime._state.get_or_none()
    if model is None:
        raise model_runtime.NoActiveModelError()
    if model.contentHashSha256 != model_hash:
        raise ActiveModelChangedError()


def manual_anchor(model_hash: str) -> dict[str, Any]:
    _require_active_hash(model_hash)
    return gis_anchor.read_anchor(model_cache.CACHE_DIR, model_hash)


def save_manual_anchor(model_hash: str, anchor: dict[str, float]) -> dict[str, Any]:
    _require_active_hash(model_hash)
    return gis_anchor.save_anchor(model_cache.CACHE_DIR, model_hash, anchor)


def delete_manual_anchor(model_hash: str) -> dict[str, Any]:
    _require_active_hash(model_hash)
    return gis_anchor.delete_anchor(model_cache.CACHE_DIR, model_hash)


def element_by_global_id(global_id: str) -> dict[str, Any]:
    with lease_active_model() as lease:
        return extract_element(lease, global_id)


def active_model_materials() -> tuple[MaterialUse, ...]:
    with open_model_session() as session:
        return survey_materials(session.ifc_file)
