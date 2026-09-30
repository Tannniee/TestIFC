"""Staged model handover. Cache leases outlive individual HTTP requests."""
from dataclasses import asdict, dataclass
from threading import RLock
from time import monotonic

import model_cache
import model_runtime as runtime


class TransactionConflict(ValueError):
    pass


@dataclass
class Stage:
    model: runtime.ActiveModel
    previous: runtime.ActiveModel | None
    expires: float
    fingerprint: tuple[int, int, int]
    status: str = "prepared"
    pinned: bool = True


_lock = RLock()
_stages: dict[str, Stage] = {}
LEASE_SECONDS = 1800.0
JOURNAL_SECONDS = 300.0


def _fingerprint(path) -> tuple[int, int, int]:
    from pathlib import Path
    info = Path(path).stat()
    return info.st_size, info.st_mtime_ns, info.st_ino


def _release(stage: Stage) -> None:
    if stage.pinned:
        model_cache.unpin_model(stage.model.contentHashSha256)
        if stage.previous:
            model_cache.unpin_model(stage.previous.contentHashSha256)
        stage.pinned = False


def reap_stages(*, shutdown: bool = False) -> None:
    with _lock:
        for key, stage in list(_stages.items()):
            if shutdown or stage.expires < monotonic():
                # Never undo a committed model behind a successfully switched UI.
                _release(stage)
                del _stages[key]


def snapshot(key: str) -> dict:
    with _lock:
        stage = _stages.get(key)
        if stage is None:
            raise TransactionConflict("model_stage_expired")
        return {"stageId": key, "status": stage.status, "model": {"ok": True, **asdict(stage.model)}}


def prepare(key: str, model_hash: str, filename: str | None) -> dict:
    with _lock:
        reap_stages()
        existing = _stages.get(key)
        if existing:
            if existing.model.contentHashSha256 != model_hash:
                raise TransactionConflict("model_stage_identity_mismatch")
            return snapshot(key)
        model_cache.pin_model(model_hash)
        previous = None
        try:
            path = model_cache.cached_model_file(model_hash)
            fingerprint = _fingerprint(path)
            cached = model_cache.validate_model_file(str(path), model_hash)
            if _fingerprint(path) != fingerprint:
                raise TransactionConflict("staged_model_file_changed")
            previous = runtime._state.capture_optional_and_pin()
            _stages[key] = Stage(runtime._active_model(cached, filename), previous, monotonic() + LEASE_SECONDS, fingerprint)
        except BaseException:
            model_cache.unpin_model(model_hash)
            if previous:
                model_cache.unpin_model(previous.contentHashSha256)
            raise
        return snapshot(key)


def transition(key: str, action: str) -> dict:
    with _lock:
        reap_stages()
        stage = _stages.get(key)
        if stage is None:
            raise TransactionConflict("model_stage_expired")
        if action == "commit":
            if stage.status == "prepared":
                if _fingerprint(stage.model.path) != stage.fingerprint:
                    raise TransactionConflict("staged_model_file_changed")
                if not runtime._state.replace_if_current(stage.previous, stage.model):
                    raise TransactionConflict("active_model_generation_changed")
                stage.status = "committed"
                stage.expires = monotonic() + LEASE_SECONDS
            elif stage.status not in ("committed", "finalized"):
                raise TransactionConflict("model_stage_already_cancelled")
            elif runtime._state.get_or_none() != stage.model:
                raise TransactionConflict("active_model_generation_changed")
        elif action == "rollback":
            if stage.status == "finalized":
                raise TransactionConflict("model_stage_already_finalized")
            if stage.status == "committed" and not runtime._state.replace_if_current(stage.model, stage.previous):
                # Another generation owns the backend; a late cleanup cannot erase it.
                raise TransactionConflict("active_model_generation_changed")
            stage.status = "rolled_back"
            _release(stage)
            stage.expires = monotonic() + JOURNAL_SECONDS
        elif action == "finalize":
            if stage.status not in ("committed", "finalized"):
                raise TransactionConflict("model_stage_not_committed")
            stage.status = "finalized"
            _release(stage)
            stage.expires = monotonic() + JOURNAL_SECONDS
        else:
            raise ValueError("invalid_stage_action")
        return snapshot(key)
