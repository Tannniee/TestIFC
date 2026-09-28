"""Persistent user-supplied map anchors, separate from disposable model bundles."""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Any


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_LOCK = RLock()


def _path(root: Path, model_hash: str) -> Path:
    if not _HASH.fullmatch(model_hash):
        raise ValueError("invalid_model_hash")
    return root / "gis_anchors" / f"{model_hash}.json"


def read_anchor(root: Path, model_hash: str) -> dict[str, Any]:
    path = _path(root, model_hash)
    with _LOCK:
        if not path.exists():
            return {"modelHash": model_hash, "status": "unavailable", "source": None}
        payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1 or payload.get("modelHash") != model_hash or payload.get("source") != "manual":
        raise ValueError("invalid_saved_anchor")
    return {"modelHash": model_hash, "status": "manual", "source": "manual",
            "anchor": payload["anchor"], "updatedAt": payload["updatedAt"]}


def save_anchor(root: Path, model_hash: str, anchor: dict[str, float]) -> dict[str, Any]:
    path = _path(root, model_hash)
    payload = {"schemaVersion": 1, "modelHash": model_hash, "source": "manual",
               "anchor": anchor, "updatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z")}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with _LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary: str | None = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                             prefix=f"{model_hash}.", suffix=".partial", delete=False) as stream:
                temporary = stream.name
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if temporary is not None:
                Path(temporary).unlink(missing_ok=True)
    return {"modelHash": model_hash, "status": "manual", "source": "manual",
            "anchor": anchor, "updatedAt": payload["updatedAt"]}


def delete_anchor(root: Path, model_hash: str) -> dict[str, Any]:
    path = _path(root, model_hash)
    with _LOCK:
        path.unlink(missing_ok=True)
    return {"modelHash": model_hash, "status": "unavailable", "source": None}
