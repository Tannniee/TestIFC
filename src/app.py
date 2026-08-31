"""Compose the local HTTP bridge used by the IFC Viewer desktop shell."""

from __future__ import annotations

import logging
from threading import Thread
from time import sleep

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api_contracts import (
    ErrorResponse,
    HealthResponse,
    LoadModelResponse,
    MemberScanRequest,
    RegisterModelRequest,
    SelectionPayload,
    SelectionResponse,
    TakeoffRequest,
)
from api_routes.core import create_core_router
from api_routes.idea import create_idea_router
from api_routes.mass import create_mass_router
from api_routes.model import create_model_router
from api_state import BridgeState
from fragment_service import FragmentService
from member_scan_service import MemberScanService
from model_runtime import release_idle_model
from takeoff_service import ModelTakeoffJob, TakeoffService
from version import APP_VERSION


LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost", "testclient"}
ALLOWED_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}
IDLE_MODEL_SWEEP_SECONDS = 60.0
logger = logging.getLogger("ifc_viewer.backend")


def _reap_idle_model() -> None:
    while True:
        sleep(IDLE_MODEL_SWEEP_SECONDS)
        try:
            release_idle_model()
        except Exception:
            logger.exception(
                "Idle model reaper failed",
                extra={"event": "idle_model_reaper_failed"},
            )


state = BridgeState()
fragment_service = FragmentService()
member_scan_service = MemberScanService()
takeoff_service = TakeoffService()
model_takeoff_job = ModelTakeoffJob(takeoff_service)

app = FastAPI(title="IFC Viewer", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def reject_non_local_clients(request: Request, call_next):
    host = request.client.host if request.client else ""
    if host not in LOCAL_CLIENTS:
        return JSONResponse(
            status_code=403,
            content=ErrorResponse(error="local_only").model_dump(),
        )
    return await call_next(request)


app.include_router(create_core_router(state))
app.include_router(create_model_router(fragment_service))
app.include_router(create_mass_router(model_takeoff_job, takeoff_service))
app.include_router(create_idea_router(member_scan_service))

Thread(target=_reap_idle_model, name="idle-model-reaper", daemon=True).start()
