"""Persistent IFC, fragment, index, and store cache operations."""

from __future__ import annotations

import os
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from time import monotonic_ns, time
from typing import Any, BinaryIO

import index_builder
from content_hash import copy_and_hash, sha256_file


CACHE_DIR = Path(
    os.environ.get("IFC_MODEL_CACHE_DIR") or Path(__file__).parent / ".model_cache"
)


def cache_keep_models(raw: str | None) -> int:
    return max(1, int(raw or 3))


def cache_max_bytes(raw: str | None) -> int:
    return max(1, int(raw or 10 * 1024 * 1024 * 1024))


CACHE_KEEP_MODELS = cache_keep_models(os.environ.get("IFC_CACHE_KEEP_MODELS"))
CACHE_MAX_BYTES = cache_max_bytes(os.environ.get("IFC_CACHE_MAX_BYTES"))

_BUNDLE_PATTERNS = ("*.ifc", "*.frag", "*.sqlite", "*.rdb")
_PARTIAL_PATTERNS = (
    "*.ifc.partial",
    "*.frag.partial",
    "*.frag.*.partial",
    "*.sqlite.partial",
    "*.rdb.partial",
)
_PARTIAL_MAX_AGE_SECONDS = 24 * 60 * 60
_BUILD_LOCK_PATTERN = "*.semantic-v*.lock"
_VERSIONED_BUNDLE_MARKERS = (".fragments-v", ".semantic-v", ".facts-v")
_retention_lock = threading.RLock()
_pins: dict[str, int] = {}


@dataclass(frozen=True, slots=True)
class CachedModel:
    path: Path
    content_hash: str
    size_bytes: int


def ensure_cache_dir() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def pin_model(model_hash: str) -> None:
    """Prevent a model bundle from being evicted while an operation uses it."""
    with _retention_lock:
        _pins[model_hash] = _pins.get(model_hash, 0) + 1


def unpin_model(model_hash: str) -> None:
    """Release one retention pin acquired by :func:`pin_model`."""
    with _retention_lock:
        count = _pins.get(model_hash, 0)
        if count <= 1:
            _pins.pop(model_hash, None)
        else:
            _pins[model_hash] = count - 1


def pinned_model_hashes() -> frozenset[str]:
    with _retention_lock:
        return frozenset(_pins)


def model_source_path(model: Any) -> str:
    store = index_builder.store_path_for(CACHE_DIR, model.contentHashSha256)
    return str(store) if index_builder.store_is_usable(store) else model.path


def _remove_cache_path(path: Path) -> None:
    try:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink()
    except FileNotFoundError:
        return
    except Exception:
        return


def _bundle_hash(path: Path) -> str:
    stem = path.stem
    for marker in _VERSIONED_BUNDLE_MARKERS:
        if marker in stem:
            return stem.partition(marker)[0]
    return stem


def _partial_bundle_hash(path: Path) -> str | None:
    name = path.name
    if not name.endswith(".partial") or name.startswith("incoming-"):
        return None
    base = name[: -len(".partial")]
    if ".frag." in base:
        return base.partition(".frag.")[0]
    return _bundle_hash(Path(base))


def _path_size(path: Path) -> int:
    try:
        if path.is_dir():
            return sum(
                child.stat().st_size
                for child in path.rglob("*")
                if child.is_file()
            )
        return path.stat().st_size
    except OSError:
        return 0


def enforce_cache_retention(active_hash: str) -> None:
    with _retention_lock:
        ensure_cache_dir()
        live_partials: set[Path] = set()
        for pattern in _PARTIAL_PATTERNS:
            for path in CACHE_DIR.glob(pattern):
                try:
                    stale = time() - path.stat().st_mtime >= _PARTIAL_MAX_AGE_SECONDS
                except OSError:
                    stale = False
                if stale:
                    _remove_cache_path(path)
                else:
                    live_partials.add(path)

        bundles: dict[str, list[Path]] = {}
        for pattern in _BUNDLE_PATTERNS:
            for path in CACHE_DIR.glob(pattern):
                bundles.setdefault(_bundle_hash(path), []).append(path)

        protected = set(_pins)
        protected.add(active_hash)
        protected.update(
            model_hash
            for path in live_partials
            if (model_hash := _partial_bundle_hash(path)) is not None
        )
        for path in CACHE_DIR.glob(_BUILD_LOCK_PATTERN):
            try:
                stale = (
                    time() - path.stat().st_mtime
                    >= index_builder._BUILD_LOCK_MAX_AGE_SECONDS
                )
            except OSError:
                stale = False
            if stale:
                _remove_cache_path(path)
            else:
                protected.add(_bundle_hash(path))
        for model_hash in protected:
            for path in bundles.get(model_hash, []):
                try:
                    os.utime(path)
                except Exception:
                    continue

        def recency(model_hash: str) -> float:
            times = []
            for path in bundles[model_hash]:
                try:
                    times.append(path.stat().st_mtime)
                except OSError:
                    continue
            return max(times, default=0.0)

        candidates = sorted(
            (model_hash for model_hash in bundles if model_hash not in protected),
            key=recency,
            reverse=True,
        )
        kept_count = sum(1 for model_hash in bundles if model_hash in protected)
        kept_bytes = sum(
            _path_size(path)
            for model_hash in protected
            for path in bundles.get(model_hash, [])
        )
        for model_hash in candidates:
            size = sum(_path_size(path) for path in bundles[model_hash])
            within_count = kept_count < CACHE_KEEP_MODELS
            within_bytes = kept_bytes + size <= CACHE_MAX_BYTES
            if within_count and within_bytes:
                kept_count += 1
                kept_bytes += size
                continue
            for path in bundles[model_hash]:
                _remove_cache_path(path)


def fragments_cache_path(model_hash: str) -> Path:
    return CACHE_DIR / f"{model_hash}.frag"


def cached_fragments_file(model_hash: str) -> Path:
    path = fragments_cache_path(model_hash)
    if not path.exists():
        raise FileNotFoundError(f"no cached fragments for {model_hash}")
    return path


def cached_model_file(model_hash: str) -> Path:
    path = CACHE_DIR / f"{model_hash}.ifc"
    if not path.exists() or path.stat().st_size == 0:
        raise FileNotFoundError(f"no cached model for {model_hash}")
    return path


def store_cached_fragments_start(model_hash: str) -> Path:
    ensure_cache_dir()
    return CACHE_DIR / (
        f"{model_hash}.frag.{threading.get_ident()}-{monotonic_ns()}.partial"
    )


def store_cached_fragments_commit(model_hash: str, staging: Path) -> int:
    size = staging.stat().st_size
    if size == 0:
        staging.unlink(missing_ok=True)
        raise ValueError("empty fragments body")
    target = fragments_cache_path(model_hash)
    os.replace(staging, target)
    return size


def store_model_stream(reader: BinaryIO) -> CachedModel:
    """Copy, hash, and atomically install an IFC stream in the model cache."""
    ensure_cache_dir()
    staging = CACHE_DIR / (
        f"incoming-{threading.get_ident()}-{monotonic_ns()}.ifc.partial"
    )
    try:
        model_hash, size = copy_and_hash(reader, staging)
        if size == 0:
            raise ValueError("empty model body")
    except BaseException:
        staging.unlink(missing_ok=True)
        raise

    target = CACHE_DIR / f"{model_hash}.ifc"
    try:
        target_is_valid = (
            target.exists()
            and target.stat().st_size == size
            and sha256_file(target) == model_hash
        )
        if target_is_valid:
            staging.unlink()
        else:
            os.replace(staging, target)
        return CachedModel(target, model_hash, size)
    except BaseException:
        staging.unlink(missing_ok=True)
        raise


def validate_model_file(path: str, expected_hash: str) -> CachedModel:
    """Validate an existing IFC file without copying it into the cache."""
    model_path = Path(path)
    if not model_path.exists():
        raise FileNotFoundError(f"model path not found: {path}")
    actual = sha256_file(model_path)
    if actual != expected_hash:
        raise ValueError(f"hash mismatch for {path}: expected {expected_hash} got {actual}")
    return CachedModel(model_path.resolve(), actual, model_path.stat().st_size)


# Compatibility aliases for the recovered names.
_cache_keep_models = cache_keep_models
_cache_max_bytes = cache_max_bytes
_ensure_cache_dir = ensure_cache_dir
_enforce_cache_retention = enforce_cache_retention
_fragments_cache_path = fragments_cache_path
