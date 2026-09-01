"""Health and selection routes."""

from __future__ import annotations

from fastapi import APIRouter

from api_contracts import (
    HealthResponse,
    SelectionPayload,
    SelectionResponse,
)
from api_state import BridgeState


def create_core_router(state: BridgeState) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health():
        return HealthResponse(hasSelection=state.has_selection())

    @router.get("/selection", response_model=SelectionResponse)
    async def get_selection():
        return state.get_selection()

    @router.post("/selection", response_model=SelectionResponse)
    async def post_selection(selection: SelectionPayload):
        return state.set_selection(selection)

    @router.delete("/selection", response_model=SelectionResponse)
    async def delete_selection():
        return state.clear_selection()

    return router
