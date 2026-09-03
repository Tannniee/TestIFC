"""Active-model lifecycle, semantic index preparation, and live IFC access."""

from __future__ import annotations

import io
import logging
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Event, Lock, RLock
from time import monotonic
from typing import Any, BinaryIO, Callable

import ifcopenshell

import facts_cache
import index_builder
import model_cache
import model_index
from background_tasks import LatestTaskRunner
from index_progress import IndexProgress

_index_progress = IndexProgress()


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


@dataclass(frozen=True, slots=True)
class ModelRef:
    """Immutable paths and identity captured for one model operation."""

    path: str
    source_path: str
    model_hash: str
    index_path: str
    original_filename: str | None
    size_bytes: int


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
        self._lock = RLock()
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

    def capture_and_pin(self) -> ActiveModel:
        with self._lock:
            if self._active is None:
                raise NoActiveModelError("no active model")
            model = self._active
            model_cache.pin_model(model.contentHashSha256)
            return model

    def capture_optional_and_pin(self) -> ActiveModel | None:
        with self._lock:
            if self._active:
                model_cache.pin_model(self._active.contentHashSha256)
            return self._active

    def replace_if_current(self, expected: ActiveModel | None, replacement: ActiveModel | None) -> bool:
        """Commit/rollback by generation, including reopening identical IFC bytes."""
        with self._lock:
            if self._active != expected:
                return False
            if replacement is None:
                _background_indexes.cancel()
                self.clear()
            else:
                self.set(replacement)
                try:
                    model_cache.schedule_cache_retention(replacement.contentHashSha256)
                    _queue_index_build(replacement)
                except BaseException:
                    if expected is None:
                        self.clear()
                    else:
                        self.set(expected)
                        model_cache.schedule_cache_retention(expected.contentHashSha256)
                    raise
            return True

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

    def retry_index(self, model_hash: str, loaded_at: str, attempt_id: str) -> bool:
        with self._lock:
            model = self._active
            if model is None or model.contentHashSha256 != model_hash or model.loadedAt != loaded_at:
                return False
            progress = _index_progress.snapshot(model_hash)
            if progress is None or progress["attemptId"] != attempt_id:
                return False
            if not progress["stalled"] and progress["status"] != "error":
                return False
            _background_indexes.cancel()
            _queue_index_build(model)
            return True

    def cancel_load(self, model_hash: str, loaded_at: str, cancel: Callable[[], None]) -> bool:
        with self._lock:
            if self._active is None or (self._active.contentHashSha256, self._active.loadedAt) != (model_hash, loaded_at):
                return False
            cancel()
            self._active = None
            self._ifc_file = None
            self._ifc_hash = None
            return True

    def clear_if(self, model_hash: str) -> None:
        with self._lock:
            if self._active is not None and self._active.contentHashSha256 == model_hash:
                self._active = None
                self._ifc_file = None
                self._ifc_hash = None


_prepare = _PrepareState()
_state = _ActiveModelState()
_background_indexes = LatestTaskRunner("ifc-index-prepare")


class ModelLease:
    """Own a cache-retention pin for one immutable model reference."""

    def __init__(self, ref: ModelRef) -> None:
        self.ref = ref
        self._lock = Lock()
        self._released = False
        self._session_opened = False

    @property
    def index(self) -> model_index.ModelIndex:
        return model_index.ModelIndex(Path(self.ref.index_path))

    def open_session(self) -> ModelSession:
        with self._lock:
            if self._released:
                raise RuntimeError("model lease has been released")
            if self._session_opened:
                raise RuntimeError("model lease already opened a session")
            self._session_opened = True
        try:
            ifc_file = ifcopenshell.open(self.ref.source_path)
        except BaseException:
            self.release()
            raise
        return ModelSession(self, ifc_file)

    def release(self) -> None:
        with self._lock:
            if self._released:
                return
            self._released = True
        model_cache.unpin_model(self.ref.model_hash)

    def __enter__(self) -> ModelLease:
        return self

    def __exit__(self, *_args) -> None:
        self.release()


class ModelSession:
    """Dedicated IFC handle and semantic index bound to one model hash."""

    def __init__(self, lease: ModelLease, ifc_file: Any) -> None:
        self._lease = lease
        self.ref = lease.ref
        self.ifc_file = ifc_file
        self.index = lease.index
        self._facts = None
        self._closed = False

    @property
    def facts(self) -> facts_cache.FactsCache:
        if self._facts is None:
            self._facts = facts_cache.FactsCache(
                facts_cache.path_for(
                    Path(self.ref.index_path).parent, self.ref.model_hash
                ),
                self.ref.model_hash,
            )
        return self._facts

    def locate_global_id(self, global_id: str):
        record = self.index.record_by_global_id(global_id)
        element = self.ifc_file.by_id(int(record["expressId"]))
        if getattr(element, "GlobalId", None) != global_id:
            raise LookupError(
                f"{global_id} is not express id {record['expressId']} in this model"
            )
        return element

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.ifc_file = None
        self._lease.release()

    def __enter__(self) -> ModelSession:
        return self

    def __exit__(self, *_args) -> None:
        self.close()


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
    *, activate: bool = True,
) -> dict:
    cached = model_cache.store_model_stream(reader, pin_for_activation=True)
    try:
        model = _active_model(cached, original_filename)
        if activate:
            (_activate_in_background if background else _activate)(model)
        return asdict(model)
    finally:
        model_cache.unpin_model(cached.content_hash)


def materialize_model_file(
    raw_bytes: bytes,
    original_filename: str | None,
    background: bool = False,
) -> dict:
    return materialize_model_stream(io.BytesIO(raw_bytes), original_filename, background)


def register_model(path: str, expected_hash: str, background: bool = False) -> dict:
    model_cache.pin_model(expected_hash)
    try:
        try:
            cached = model_cache.validate_model_file(path, expected_hash)
        except ValueError as error:
            raise HashMismatchError(str(error)) from error
        model = _active_model(cached, cached.path.name)
        (_activate_in_background if background else _activate)(model)
        return asdict(model)
    finally:
        model_cache.unpin_model(expected_hash)


def _activate(model: ActiveModel) -> None:
    _state.set(model)
    model_cache.schedule_cache_retention(model.contentHashSha256)
    _background_indexes.cancel()
    target = model_index.index_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
    if model_index.is_usable(target):
        _prepare.clear_error(model.contentHashSha256)
        return
    if not _prepare.begin(model.contentHashSha256):
        raise IndexPreparingError(model.contentHashSha256)
    _run_build(model, target)


def _run_build(model: ActiveModel, target, cancelled: Event | None = None, attempt: str | None = None) -> None:
    model_cache.ensure_cache_dir()
    try:
        index_builder.prepare_model(
            model.path,
            model.contentHashSha256,
            str(model_cache.CACHE_DIR),
            cancelled=cancelled.is_set if cancelled else lambda: False,
            on_hot_ready=lambda: _prepare.end(model.contentHashSha256),
            on_progress=(lambda event: _index_progress.update(attempt, event)) if attempt else None,
        )
        if not model_index.is_usable(target):
            raise RuntimeError(
                f"index build produced no usable index for {model.contentHashSha256}"
            )
    except index_builder.BuildCancelled:
        _prepare.end(model.contentHashSha256)
        raise
    except Exception as error:
        _prepare.end(model.contentHashSha256, error=str(error))
        raise
    _prepare.end(model.contentHashSha256, None)


def _ref_for(model: ActiveModel) -> ModelRef:
    target = model_index.index_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
    return ModelRef(
        path=model.path,
        source_path=model_source_path(model),
        model_hash=model.contentHashSha256,
        index_path=str(target),
        original_filename=model.originalFilename,
        size_bytes=model.sizeBytes,
    )


def lease_active_model() -> ModelLease:
    """Atomically capture and pin the active model for a request or job."""
    model = _state.capture_and_pin()
    try:
        target = model_index.index_path_for(
            model_cache.CACHE_DIR,
            model.contentHashSha256,
        )
        if not model_index.is_usable(target):
            if _background_indexes.contains(model.contentHashSha256):
                raise IndexPreparingError(model.contentHashSha256)
            if not _prepare.begin(model.contentHashSha256):
                raise IndexPreparingError(model.contentHashSha256)
            _run_build(model, target)
        return ModelLease(_ref_for(model))
    except BaseException:
        model_cache.unpin_model(model.contentHashSha256)
        raise


def lease_model(ref: ModelRef) -> ModelLease:
    """Pin an explicit reference, primarily for benchmark and offline workflows."""
    if not model_index.is_usable(Path(ref.index_path)):
        raise FileNotFoundError(f"no usable index for {ref.model_hash}")
    model_cache.pin_model(ref.model_hash)
    return ModelLease(ref)


def open_model_session(
    lease: ModelLease | None = None,
    model_ref: ModelRef | None = None,
) -> ModelSession:
    if lease is not None and model_ref is not None:
        raise ValueError("provide either lease or model_ref, not both")
    owned_lease = lease or (lease_model(model_ref) if model_ref else lease_active_model())
    return owned_lease.open_session()


def _activate_in_background(model: ActiveModel) -> None:
    _state.set(model)
    model_cache.schedule_cache_retention(model.contentHashSha256)
    _queue_index_build(model)


def _queue_index_build(model: ActiveModel) -> None:
    current = _index_progress.snapshot(model.contentHashSha256)
    if current and current["status"] == "running" and _background_indexes.contains(model.contentHashSha256):
        return
    attempt = _index_progress.begin(model.contentHashSha256)
    target = model_index.index_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
    if model_index.is_complete(target):
        _background_indexes.cancel()
        _index_progress.update(attempt, {"phase": "ready", "status": "ready"})
        _prepare.clear_error(model.contentHashSha256)
        return
    _prepare.clear_error(model.contentHashSha256)

    def run(cancelled: Event) -> None:
        model_cache.pin_model(model.contentHashSha256)
        try:
            if not _prepare.begin(model.contentHashSha256):
                return
            _run_build(model, target, cancelled, attempt)
            _index_progress.update(attempt, {"phase": "ready", "status": "ready"})
        except index_builder.BuildCancelled:
            logger.info(
                "Index build superseded by a newer model",
                extra={"event": "background_index_cancelled", "modelHash": model.contentHashSha256},
            )
        except Exception as error:
            _index_progress.update(attempt, {"status": "error", "error": str(error)})
            logger.exception(
                "Background index build failed for %s",
                model.contentHashSha256[:12],
                extra={"event": "background_index_failed", "modelHash": model.contentHashSha256},
            )
        finally:
            model_cache.unpin_model(model.contentHashSha256)

    _background_indexes.submit(model.contentHashSha256, run)


def active_index() -> model_index.ModelIndex:
    with lease_active_model() as lease:
        return lease.index


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
    target = (
        model_index.index_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
        if model
        else None
    )
    semantic_progress = _index_progress.snapshot(model.contentHashSha256) if model else None
    preparing = model is not None and _prepare.is_preparing(model.contentHashSha256)
    if semantic_progress and semantic_progress["status"] == "running":
        preparing = semantic_progress["phase"] not in ("cold", "ready")
    elif model is not None and _background_indexes.contains(model.contentHashSha256):
        preparing = not model_index.is_usable(target)
    prepare_error = _prepare.error_for(model.contentHashSha256) if model else None
    if model is None:
        hot_index_status = "idle"
    elif preparing:
        hot_index_status = "indexing"
    elif semantic_progress and semantic_progress["phase"] in ("cold", "ready"):
        hot_index_status = "ready"
    elif prepare_error:
        hot_index_status = "error"
    else:
        hot_index_status = "ready"
    return {
        "semanticProgress": semantic_progress,
        "hasActiveModel": model is not None,
        "activeModelHash": model.contentHashSha256 if model else None,
        "activeLoadedAt": model.loadedAt if model else None,
        "modelResident": _state.is_open(),
        "preparing": preparing,
        "prepareError": prepare_error,
        "hotIndexStatus": hot_index_status,
        "coldIndexStatus": ("indexing" if semantic_progress["status"] == "running" else semantic_progress["status"])
            if semantic_progress else (model_index.cold_status(target) if target else "not_configured"),
        "coldIndexError": semantic_progress.get("error") if semantic_progress else (model_index.cold_error(target) if target else None),
        "storeBacked": model is not None
        and index_builder.store_is_usable(
            index_builder.store_path_for(model_cache.CACHE_DIR, model.contentHashSha256)
        ),
        "sizeBytes": model.sizeBytes if model else 0,
        "liveModelMaxBytes": LIVE_MODEL_MAX_BYTES,
        "idleSeconds": LIVE_MODEL_IDLE_SECONDS,
    }


def cancel_active_load(model_hash: str, loaded_at: str) -> bool:
    """Cancel only the exact activation owned by the caller, including same-hash reloads."""
    return _state.cancel_load(model_hash, loaded_at, _background_indexes.cancel)


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


def should_open_ref_for_geometry(ref: ModelRef) -> bool:
    source = Path(ref.source_path)
    return source.is_dir() or ref.size_bytes <= LIVE_MODEL_MAX_BYTES


_should_open_for_geometry = should_open_for_geometry


def retry_semantic_index(model_hash: str, loaded_at: str, attempt_id: str) -> bool:
    return _state.retry_index(model_hash, loaded_at, attempt_id)
