"""Authentication, health, and selection routes."""

from __future__ import annotations

from fastapi import APIRouter

import license_gate
from api_contracts import HealthResponse, SelectionPayload, SelectionResponse
from api_state import BridgeState


def create_core_router(state: BridgeState) -> APIRouter:
    router = APIRouter()

    @router.get("/auth/status", response_model=dict)
    async def auth_status():
        return license_gate.status()

    @router.post("/auth/login", response_model=dict)
    async def auth_login():
        return license_gate.login()

    @router.post("/auth/logout", response_model=dict)
    async def auth_logout():
        license_gate.logout()
        return {"ok": True}

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
