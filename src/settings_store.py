"""Persist small desktop UI preferences outside the packaged executable."""

from __future__ import annotations

import json
import math
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any


DEFAULT_SETTINGS: dict[str, Any] = {
    "schemaVersion": 1,
    "locale": "vi",
    "mode": "light",
    "gridVisible": True,
    "viewportBackground": "gray",
    "wheelZoomSpeed": 1.0,
    "rotationSpeed": 1.0,
}


def normalize_settings(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    result = dict(DEFAULT_SETTINGS)
    if source.get("locale") in {"vi", "en"}:
        result["locale"] = source["locale"]
    if source.get("mode") in {"light", "dark"}:
        result["mode"] = source["mode"]
    if isinstance(source.get("gridVisible"), bool):
        result["gridVisible"] = source["gridVisible"]
    if source.get("viewportBackground") in {"gray", "white", "oled"}:
        result["viewportBackground"] = source["viewportBackground"]
    for key in ("wheelZoomSpeed", "rotationSpeed"):
        speed = source.get(key)
        if isinstance(speed, (int, float)) and not isinstance(speed, bool):
            speed = float(speed)
            if math.isfinite(speed) and 0.25 <= speed <= 3.0:
                result[key] = speed
    return result


class SettingsStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = Lock()

    def load(self) -> dict[str, Any] | None:
        with self._lock:
            try:
                if not self.path.is_file():
                    return None
                value = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                return None
            return normalize_settings(value)

    def save(self, value: Any) -> dict[str, Any]:
        normalized = normalize_settings(value)
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    dir=self.path.parent,
                    prefix=f".{self.path.name}.",
                    suffix=".tmp",
                    delete=False,
                ) as temporary:
                    json.dump(normalized, temporary, ensure_ascii=False, indent=2)
                    temporary.write("\n")
                    temporary.flush()
                    os.fsync(temporary.fileno())
                    temporary_path = Path(temporary.name)
                os.replace(temporary_path, self.path)
            finally:
                if temporary_path is not None and temporary_path.exists():
                    temporary_path.unlink(missing_ok=True)
        return normalized
