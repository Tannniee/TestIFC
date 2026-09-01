"""Build model-derived artifacts outside the server process."""

from __future__ import annotations

import multiprocessing
import os
import shutil
import sys
from pathlib import Path
from time import sleep, time

import model_index

_POLL_SECONDS = 0.5
_BUILD_LOCK_MAX_AGE_SECONDS = 2 * 60 * 60
STORE_MIN_BYTES = int(os.environ.get("IFC_STORE_MIN_BYTES") or 268_435_456)


def store_path_for(cache_dir: Path, model_hash: str) -> Path:
    return cache_dir / f"{model_hash}.rdb"


def store_is_usable(path: Path) -> bool:
    return path.is_dir() and (path / "CURRENT").exists()


def build_lock_path_for(cache_dir: Path, model_hash: str) -> Path:
    return cache_dir / f"{model_hash}.semantic-v{model_index.INDEX_SCHEMA_VERSION}.lock"


def _claim_build_lock(target: Path, lock_path: Path) -> bool:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        if model_index.is_usable(target):
            return False
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                stale = time() - lock_path.stat().st_mtime >= _BUILD_LOCK_MAX_AGE_SECONDS
            except OSError:
                stale = False
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
        if model_index.is_usable(target):
            lock_path.unlink(missing_ok=True)
            return False
        return True


def prepare_model(model_path: str, model_hash: str, cache_dir: str) -> None:
    cache_path = Path(cache_dir)
    target = model_index.index_path_for(cache_path, model_hash)
    lock_path = build_lock_path_for(cache_path, model_hash)
    if not _claim_build_lock(target, lock_path):
        return
    try:
        context = multiprocessing.get_context("spawn")
        process = context.Process(
            target=_child_main,
            args=(model_path, model_hash, cache_dir, str(lock_path)),
            name="ifc-index-build",
            daemon=False,
        )
        process.start()
    except (OSError, ValueError, RuntimeError):
        try:
            _worker(model_path, model_hash, cache_dir)
        finally:
            lock_path.unlink(missing_ok=True)
        return

    while process.is_alive():
        if model_index.is_usable(target):
            return
        process.join(timeout=_POLL_SECONDS)
    if not model_index.is_usable(target):
        raise RuntimeError(
            f"model preparation process failed with exit code {process.exitcode}"
        )


def _child_main(
    model_path: str,
    model_hash: str,
    cache_dir: str,
    lock_path: str,
) -> None:
    held = []
    try:
        _worker(model_path, model_hash, cache_dir, held)
        code = 0
    except BaseException:
        import traceback

        traceback.print_exc()
        code = 1
    Path(lock_path).unlink(missing_ok=True)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)


def _worker(
    model_path: str,
    model_hash: str,
    cache_dir: str,
    keep_alive: list | None = None,
) -> None:
    os.environ["IFC_MODEL_CACHE_DIR"] = cache_dir
    import ifcopenshell
    import ifc_elements
    import ifc_units

    source = _ensure_store(model_path, model_hash, Path(cache_dir)) or model_path
    ifc_file = ifcopenshell.open(source)
    if keep_alive is not None:
        keep_alive.append(ifc_file)
    units = ifc_units.project_units(ifc_file)
    target = model_index.index_path_for(Path(cache_dir), model_hash)
    model_index.build_hot(
        ifc_file,
        target,
        model_hash,
        build_record=ifc_elements.build_hot_record,
        child_ids=lambda entity: [child.id() for child in ifc_elements.direct_children(entity)],
    )
    model_index.build_cold(
        ifc_file,
        target,
        build_record=lambda entity: ifc_elements.build_cold_record(entity, ifc_file, units),
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
