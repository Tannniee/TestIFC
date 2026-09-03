"""Build model-derived artifacts outside the server process."""

from __future__ import annotations

import multiprocessing
import os
import shutil
import sys
from pathlib import Path
from threading import Lock
from time import monotonic, sleep, time
from typing import Callable

import model_index
from index_writer import process_alive, writer_lease

_POLL_SECONDS = 0.5
_BUILD_LOCK_MAX_AGE_SECONDS = 2 * 60 * 60
STORE_MIN_BYTES = int(os.environ.get("IFC_STORE_MIN_BYTES") or 268_435_456)
_build_slot = Lock()


class BuildCancelled(Exception):
    """A newer active model superseded this index request."""


def _check_cancel(cancelled: Callable[[], bool]) -> None:
    if cancelled():
        raise BuildCancelled()


def store_path_for(cache_dir: Path, model_hash: str) -> Path:
    return cache_dir / f"{model_hash}.rdb"


def store_is_usable(path: Path) -> bool:
    return path.is_dir() and (path / "CURRENT").exists()


def build_lock_path_for(cache_dir: Path, model_hash: str) -> Path:
    return cache_dir / f"{model_hash}.semantic-v{model_index.INDEX_SCHEMA_VERSION}.lock"


def build_lock_is_stale(lock_path: Path) -> bool:
    try:
        pids = [int(line.split("=", 1)[1]) for line in lock_path.read_text(encoding="ascii").splitlines()
                if line.startswith(("pid=", "worker="))]
        if pids:
            return not any(process_alive(pid) for pid in pids)
        return time() - lock_path.stat().st_mtime >= _BUILD_LOCK_MAX_AGE_SECONDS
    except (OSError, ValueError, UnicodeError):
        return False


def _claim_build_lock(
    target: Path, lock_path: Path, cancelled: Callable[[], bool] = lambda: False,
) -> bool:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        _check_cancel(cancelled)
        if model_index.is_complete(target):
            return False
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            stale = build_lock_is_stale(lock_path)
            if stale:
                try:
                    lock_path.unlink()
                except OSError:
                    pass
                continue
            sleep(_POLL_SECONDS)
            continue
        try:
            os.write(descriptor, f"pid={os.getpid()}\n".encode("ascii"))
        finally:
            os.close(descriptor)
        if model_index.is_complete(target):
            lock_path.unlink(missing_ok=True)
            return False
        return True


def prepare_model(
    model_path: str, model_hash: str, cache_dir: str, *,
    cancelled: Callable[[], bool] = lambda: False,
    on_hot_ready: Callable[[], None] = lambda: None,
    on_progress: Callable[[dict], None] | None = None,
) -> None:
    """Own the worker until cold indexing finishes, including cancellation/reaping."""
    while not _build_slot.acquire(timeout=_POLL_SECONDS):
        _check_cancel(cancelled)
    try:
        if on_progress is None:
            _prepare_model(model_path, model_hash, cache_dir, cancelled, on_hot_ready)
        else:
            _prepare_model(model_path, model_hash, cache_dir, cancelled, on_hot_ready, on_progress)
    finally:
        _build_slot.release()


def _prepare_model(model_path, model_hash, cache_dir, cancelled, on_hot_ready, on_progress=None) -> None:
    cache_path = Path(cache_dir)
    target = model_index.index_path_for(cache_path, model_hash)
    lock_path = build_lock_path_for(cache_path, model_hash)
    if not _claim_build_lock(target, lock_path, cancelled):
        on_hot_ready()
        return
    process = None
    receiver = sender = None
    try:
        _check_cancel(cancelled)
        context = multiprocessing.get_context("spawn")
        if on_progress is not None:
            receiver, sender = context.Pipe(duplex=False)
        process = context.Process(
            target=_child_main,
            args=(model_path, model_hash, cache_dir, sender),
            name="ifc-index-build",
            daemon=False,
        )
        process.start()
        if sender is not None:
            sender.close()
        worker_error = None
        progress_closed = False
        def drain_progress():
            nonlocal hot_published, worker_error, progress_closed
            if receiver is None or progress_closed:
                return
            while True:
                try:
                    if not receiver.poll():
                        return
                    event = receiver.recv()
                except (EOFError, BrokenPipeError):
                    # Windows PeekNamedPipe may report ERROR_BROKEN_PIPE when
                    # the worker closes its last handle after the final event.
                    progress_closed = True
                    return
                if event.get("status") == "error":
                    worker_error = event.get("error")
                on_progress(event)
                if event.get("phase") in ("cold", "ready") and not hot_published:
                    on_hot_ready()
                    hot_published = True
        hot_published = False
        while process.is_alive():
            _check_cancel(cancelled)
            drain_progress()
            if not hot_published and model_index.is_usable(target):
                on_hot_ready()
                hot_published = True
            process.join(timeout=_POLL_SECONDS)
        _check_cancel(cancelled)
        drain_progress()
        if not model_index.is_complete(target):
            raise RuntimeError(
                worker_error or f"model preparation process failed with exit code {process.exitcode}"
            )
        if not hot_published:
            on_hot_ready()
    finally:
        recovery_required = cancelled()
        if process is not None:
            if process.is_alive():
                process.terminate()
            if process.pid is not None:
                process.join(timeout=5.0)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=5.0)
                    if process.is_alive():
                        raise RuntimeError("Owned index worker did not stop; build lock retained")
            recovery_required = recovery_required or process.exitcode not in (None, 0)
            process.close()
        if receiver is not None:
            receiver.close()
        if sender is not None:
            sender.close()
        # The worker is now gone. Serialize recovery with any other process that
        # acquired this cache after an earlier server crash.
        try:
            if recovery_required and target.exists():
                with writer_lease(target):
                    model_index.recover_interrupted_build(target)
        finally:
            lock_path.unlink(missing_ok=True)


def _child_main(
    model_path: str,
    model_hash: str,
    cache_dir: str,
    progress_pipe=None,
) -> None:
    last = [0.0, None]
    def publish(event):
        now = monotonic()
        completed_phase = event.get("total") is not None and event.get("completed") == event["total"]
        if progress_pipe is not None and (event.get("phase") != last[1] or now - last[0] >= 0.25 or completed_phase or event.get("status") in ("ready", "error")):
            progress_pipe.send(event)
            last[:] = [now, event.get("phase")]
    held = []
    try:
        with build_lock_path_for(Path(cache_dir), model_hash).open("a", encoding="ascii") as lock:
            lock.write(f"worker={os.getpid()}\n")
        with writer_lease(model_index.index_path_for(Path(cache_dir), model_hash)):
            _worker(model_path, model_hash, cache_dir, held, publish)
        publish({"phase": "ready", "status": "ready"})
        code = 0
    except BaseException:
        import traceback

        traceback.print_exc()
        publish({"phase": last[1] or "queued", "status": "error", "error": traceback.format_exc().splitlines()[-1]})
        code = 1
    if sys.stdout is not None:
        sys.stdout.flush()
    if sys.stderr is not None:
        sys.stderr.flush()
    os._exit(code)


def _worker(
    model_path: str,
    model_hash: str,
    cache_dir: str,
    keep_alive: list | None = None,
    on_progress: Callable[[dict], None] = lambda *_: None,
) -> None:
    os.environ["IFC_MODEL_CACHE_DIR"] = cache_dir
    import ifcopenshell
    import ifc_elements
    import ifc_units

    on_progress({"phase": "store", "completed": 0, "total": None})
    source = _ensure_store(model_path, model_hash, Path(cache_dir)) or model_path
    on_progress({"phase": "opening", "completed": 0, "total": None})
    ifc_file = ifcopenshell.open(source)
    if keep_alive is not None:
        keep_alive.append(ifc_file)
    units = ifc_units.project_units(ifc_file)
    target = model_index.index_path_for(Path(cache_dir), model_hash)
    # A cancelled cold build leaves the atomically published hot index usable.
    if not model_index.is_usable(target):
        on_progress({"phase": "hot", "completed": 0, "total": None, "category": None})
        model_index.build_hot(
            ifc_file,
            target,
            model_hash,
            build_record=ifc_elements.build_hot_record,
            child_ids=lambda entity: [child.id() for child in ifc_elements.direct_children(entity)],
            on_progress=lambda done, total, category: on_progress({"phase": "hot", "completed": done, "total": total, "category": category}),
        )
    model_index.build_cold(
        ifc_file,
        target,
        build_record=lambda entity: ifc_elements.build_cold_record(entity, ifc_file, units),
        on_progress=lambda done, total, category: on_progress({"phase": "cold", "completed": done, "total": total, "category": category}),
    )


def _ensure_store(model_path: str, model_hash: str, cache_dir: Path) -> str | None:
    if Path(model_path).stat().st_size < STORE_MIN_BYTES:
        return None
    target = store_path_for(cache_dir, model_hash)
    if store_is_usable(target):
        return str(target)

    import ifcopenshell

    staging = target.parent / f"{target.name}.partial"
    shutil.rmtree(staging, ignore_errors=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    ifcopenshell.convert_path_to_rocksdb(model_path, str(staging))
    shutil.rmtree(target, ignore_errors=True)
    staging.rename(target)
    return str(target)
