"""Shared FastAPI dependencies for local bridge routes."""

from __future__ import annotations

from fastapi import HTTPException

import license_gate


def require_license_dep() -> None:
    try:
        license_gate.require_license()
    except license_gate.LicenseError as exc:
        raise HTTPException(
            status_code=403,
            detail={"error": "not_licensed", "message": str(exc)},
        ) from exc
