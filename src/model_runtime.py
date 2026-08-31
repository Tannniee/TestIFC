"""Active-model lifecycle, semantic index preparation, and live IFC access."""

from __future__ import annotations

import io
import logging
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from threading import Lock, Thread
from time import monotonic
from typing import Any, BinaryIO

import ifcopenshell

import index_builder
import model_cache
import model_index


LIVE_MODEL_MAX_BYTES = int(os.environ.get("IFC_LIVE_MODEL_MAX_BYTES") or 268_435_456)
LIVE_MODEL_IDLE_SECONDS = float(os.environ.get("IFC_LIVE_MODEL_IDLE_SECONDS") or 600.0)
logger = logging.getLogger("ifc_viewer.backend.model_runtime")


@dataclass
class ActiveModel:
    path: str
    contentHashSha256: str
    originalFilename: str | None
    sizeBytes: int
    loadedAt: str


class NoActiveModelError(Exception):
    """Raised when an operation requires an active model and none is registered."""


class HashMismatchError(Exception):
    """Raised when a registered file does not match its declared content hash."""


class IndexPreparingError(Exception):
    """Raised while the active model's semantic index is still being prepared."""


class _PrepareState:
    def __init__(self) -> None:
        self._lock = Lock()
        self._hashes = set()
        self._last_error = None
        self._errors: dict[str, str] = {}

    def begin(self, model_hash: str) -> bool:
        with self._lock:
            if model_hash in self._hashes:
                return False
            self._hashes.add(model_hash)
            self._last_error = None
            self._errors.pop(model_hash, None)
            return True

    def end(self, model_hash: str, error: str | None = None) -> None:
        with self._lock:
            self._hashes.discard(model_hash)
            if error is not None:
                self._last_error = error
                self._errors[model_hash] = error
            else:
                self._errors.pop(model_hash, None)

    def is_preparing(self, model_hash: str) -> bool:
        with self._lock:
            return model_hash in self._hashes

    def last_error(self) -> str | None:
        with self._lock:
            return self._last_error

    def error_for(self, model_hash: str) -> str | None:
        with self._lock:
            return self._errors.get(model_hash)

    def clear_error(self, model_hash: str) -> None:
        with self._lock:
            self._errors.pop(model_hash, None)


class _ActiveModelState:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active = None
        self._ifc_file = None
        self._ifc_hash = None
        self._last_used = 0.0

    def set(self, model: ActiveModel, ifc_file=None) -> None:
        with self._lock:
            if self._ifc_hash != model.contentHashSha256:
                self._ifc_file = None
                self._ifc_hash = None
            self._active = model
            if ifc_file is not None:
                self._ifc_file = ifc_file
                self._ifc_hash = model.contentHashSha256
                self._last_used = monotonic()

    def get(self) -> ActiveModel:
        with self._lock:
            if self._active is None:
                raise NoActiveModelError("no active model")
            return self._active

    def get_or_none(self) -> ActiveModel | None:
        with self._lock:
            return self._active

    def get_open_file(self):
        with self._lock:
            if self._active is None:
                raise NoActiveModelError("no active model")
            if self._ifc_file is None or self._ifc_hash != self._active.contentHashSha256:
                self._ifc_file = ifcopenshell.open(model_source_path(self._active))
                self._ifc_hash = self._active.contentHashSha256
            self._last_used = monotonic()
            return self._ifc_file

    def is_open(self) -> bool:
        with self._lock:
            return self._ifc_file is not None and self._ifc_hash == (
                self._active.contentHashSha256 if self._active else None
            )

    def release_model(self, min_idle_seconds: float) -> bool:
        with self._lock:
            if self._ifc_file is None:
                return False
            if min_idle_seconds > 0.0 and monotonic() - self._last_used < min_idle_seconds:
                return False
            self._ifc_file = None
            self._ifc_hash = None
            return True

    def clear(self) -> None:
        with self._lock:
            self._active = None
            self._ifc_file = None
            self._ifc_hash = None

    def clear_if(self, model_hash: str) -> None:
        with self._lock:
            if self._active is not None and self._active.contentHashSha256 == model_hash:
                self._active = None
                self._ifc_file = None
                self._ifc_hash = None


_prepare = _PrepareState()
_state = _ActiveModelState()


def now_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def model_source_path(model: ActiveModel) -> str:
    return model_cache.model_source_path(model)


def _active_model(cached: model_cache.CachedModel, original_filename: str | None) -> ActiveModel:
    return ActiveModel(
        path=str(cached.path),
        contentHashSha256=cached.content_hash,
        originalFilename=original_filename,
        sizeBytes=cached.size_bytes,
        loadedAt=now_utc(),
    )


def materialize_model_stream(
    reader: BinaryIO,
    original_filename: str | None,
    background: bool = False,
) -> dict:
    cached = model_cache.store_model_stream(reader)
    model = _active_model(cached, original_filename)
    (_activate_in_background if background else _activate)(model)
    return asdict(model)


def materialize_model_file(
    raw_bytes: bytes,
    original_filename: str | None,
    background: bool = False,
) -> dict:
    return materialize_model_stream(io.BytesIO(raw_bytes), original_filename, background)


def register_model(path: str, expected_hash: str, background: bool = False) -> dict:
    try:
        cached = model_cache.validate_model_file(path, expected_hash)
    except ValueError as error:
        raise HashMismatchError(str(error)) from error
    model = _active_model(cached, cached.path.name)
    (_activate_in_background if background else _activate)(model)
    return asdict(model)


def _activate(model: ActiveModel) -> None:
    _state.set(model)
    target = model_index.index_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
    if model_index.is_usable(target):
        _prepare.clear_error(model.contentHashSha256)
        return
    if not _prepare.begin(model.contentHashSha256):
        raise IndexPreparingError(model.contentHashSha256)
    _run_build(model, target)


def _run_build(model: ActiveModel, target) -> None:
    model_cache.ensure_cache_dir()
    try:
        index_builder.prepare_model(
            model.path,
            model.contentHashSha256,
            str(model_cache.CACHE_DIR),
        )
        if not model_index.is_usable(target):
            raise RuntimeError(
                f"index build produced no usable index for {model.contentHashSha256}"
            )
    except Exception as error:
        _prepare.end(model.contentHashSha256, error=str(error))
        _state.clear_if(model.contentHashSha256)
        raise
    _prepare.end(model.contentHashSha256, None)


def _activate_in_background(model: ActiveModel) -> None:
    _state.set(model)
    target = model_index.index_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
    if model_index.is_usable(target):
        _prepare.clear_error(model.contentHashSha256)
        return
    if not _prepare.begin(model.contentHashSha256):
        return

    def run() -> None:
        try:
            _run_build(model, target)
        except Exception:
            logger.exception(
                "Background index build failed for %s",
                model.contentHashSha256[:12],
                extra={"event": "background_index_failed"},
            )

    Thread(target=run, name="ifc-index-prepare", daemon=True).start()


def active_index() -> model_index.ModelIndex:
    model = _state.get()
    if _prepare.is_preparing(model.contentHashSha256):
        raise IndexPreparingError(model.contentHashSha256)
    target = model_index.index_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
    if not model_index.is_usable(target):
        _activate(model)
    return model_index.ModelIndex(target)


def get_active_model_info() -> dict:
    return asdict(_state.get())


def open_active_model():
    model = _state.get()
    if _prepare.is_preparing(model.contentHashSha256):
        raise IndexPreparingError(model.contentHashSha256)
    return _state.get_open_file()


def locate_live_element(ifc_file: Any, global_id: str):
    record = active_index().record_by_global_id(global_id)
    element = ifc_file.by_id(int(record["expressId"]))
    if getattr(element, "GlobalId", None) != global_id:
        raise LookupError(
            f"{global_id} is not express id {record['expressId']} in this model"
        )
    return element


def release_idle_model() -> bool:
    return _state.release_model(LIVE_MODEL_IDLE_SECONDS)


def live_model_status() -> dict:
    model = _state.get_or_none()
    return {
        "hasActiveModel": model is not None,
        "modelResident": _state.is_open(),
        "preparing": model is not None and _prepare.is_preparing(model.contentHashSha256),
        "prepareError": _prepare.error_for(model.contentHashSha256) if model else None,
        "storeBacked": model is not None
        and index_builder.store_is_usable(
            index_builder.store_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
        ),
        "sizeBytes": model.sizeBytes if model else 0,
        "liveModelMaxBytes": LIVE_MODEL_MAX_BYTES,
        "idleSeconds": LIVE_MODEL_IDLE_SECONDS,
    }


def should_open_for_geometry() -> bool:
    if _state.is_open():
        return True
    model = _state.get_or_none()
    if model is None:
        return False
    if index_builder.store_is_usable(
        index_builder.store_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
    ):
        return True
    return model.sizeBytes <= LIVE_MODEL_MAX_BYTES


_should_open_for_geometry = should_open_for_geometry
