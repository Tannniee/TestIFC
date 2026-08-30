"""Thin bridge between the desktop app and the packaged authentication module."""

from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import ifc_auth as _auth

    _AVAILABLE = True
    _IMPORT_ERROR = ""
except Exception as exc:
    _AVAILABLE = False
    _IMPORT_ERROR = str(exc)


class LicenseError(Exception):
    pass


def _resource_path(*parts: str) -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass).joinpath(*parts)
    return Path(__file__).resolve().parents[1].joinpath(*parts)


@lru_cache(maxsize=1)
def _auth_mode() -> str:
    if not getattr(sys, "frozen", False):
        return "dev"
    config_path = _resource_path("desktop", "build_config.json")
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "oauth"
    if data.get("schemaVersion") != 1:
        return "oauth"
    mode = data.get("authMode")
    return mode if mode in frozenset({"oauth", "admin", "public"}) else "oauth"


def _enforced() -> bool:
    return _auth_mode() == "oauth"


def require_license() -> None:
    if not _enforced():
        return
    if not _AVAILABLE:
        raise LicenseError(f"auth module unavailable: {_IMPORT_ERROR}")
    try:
        _auth.require_license()
    except Exception as exc:
        raise LicenseError(str(exc)) from exc


def status() -> dict[str, Any]:
    mode = _auth_mode()
    if mode == "dev":
        return {
            "authenticated": True,
            "valid": True,
            "email": "dev@localhost",
            "name": "Dev (license bypassed)",
            "enforced": False,
            "authMode": mode,
        }
    if mode == "admin":
        return {
            "authenticated": True,
            "valid": True,
            "email": "admin@local",
            "name": "Admin build (auth disabled)",
            "enforced": False,
            "authMode": mode,
        }
    if mode == "public":
        return {
            "authenticated": True,
            "valid": True,
            "name": "Public build",
            "enforced": False,
            "authMode": mode,
        }
    if not _AVAILABLE:
        return {
            "authenticated": False,
            "valid": False,
            "enforced": True,
            "authMode": mode,
            "error": _IMPORT_ERROR,
        }
    data = json.loads(_auth.status())
    data["enforced"] = True
    data["authMode"] = mode
    return data


def login() -> dict[str, Any]:
    mode = _auth_mode()
    if mode != "oauth":
        return {"ok": True, "message": f"{mode} build does not require login"}
    if not _AVAILABLE:
        return {"ok": False, "message": f"auth module unavailable: {_IMPORT_ERROR}"}
    return json.loads(_auth.login())


def logout() -> None:
    if _auth_mode() == "oauth" and _AVAILABLE:
        _auth.logout()
