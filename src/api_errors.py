"""Shared HTTP error responses for application and model failures."""

from __future__ import annotations

from fastapi.responses import JSONResponse

from api_contracts import ErrorResponse
from model_runtime import IndexPreparingError, NoActiveModelError


def error_response(status_code: int, error: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(error=error).model_dump(),
    )


def model_state_error(exc: Exception) -> JSONResponse:
    if isinstance(exc, IndexPreparingError):
        return error_response(409, "index_preparing")
    if isinstance(exc, NoActiveModelError):
        return error_response(409, "no_active_model")
    raise TypeError(f"unsupported model-state error: {type(exc).__name__}")
