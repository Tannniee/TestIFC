"""Public-build compatibility API with authentication disabled."""

from __future__ import annotations

from typing import Any


class LicenseError(Exception):
    """Retained for compatibility with existing API dependency handling."""

    pass


def _auth_mode() -> str:
    return "public"


def require_license() -> None:
    return


def status() -> dict[str, Any]:
    return {
        "authenticated": True,
        "valid": True,
        "name": "Public build",
        "enforced": False,
        "authMode": "public",
    }


def login() -> dict[str, Any]:
    return {"ok": True, "message": "public build does not require login"}


def logout() -> None:
    return
