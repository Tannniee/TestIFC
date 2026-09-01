"""Shared hashing helpers for model and configuration content."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import BinaryIO

_CHUNK_BYTES = 8_388_608


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def copy_and_hash(reader: BinaryIO, target: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    written = 0
    with target.open("wb") as sink:
        while chunk := reader.read(_CHUNK_BYTES):
            digest.update(chunk)
            sink.write(chunk)
            written += len(chunk)
    return digest.hexdigest(), written


def mapping_digest(mapping: Mapping[str, float]) -> str:
    canonical = json.dumps(
        {key: float(value) for key, value in sorted(mapping.items())},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return sha256_hex(canonical.encode("utf-8"))
