"""Resolve desktop resources and writable user-data paths."""

from __future__ import annotations

import os
import sys
from pathlib import Path


APP_NAME = "IFC Viewer"
HOST = "127.0.0.1"


def user_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / APP_NAME


def resolve_dir(*parts: str) -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass).joinpath(*parts)
    return Path(__file__).resolve().parents[1].joinpath(*parts)


def configure_import_paths() -> None:
    for import_dir in (resolve_dir("vendor"), resolve_dir("src")):
        value = str(import_dir)
        if value not in sys.path:
            sys.path.insert(0, value)


def configure_packaged_cache() -> None:
    if getattr(sys, "frozen", False):
        os.environ.setdefault("IFC_MODEL_CACHE_DIR", str(user_data_dir() / "model_cache"))
