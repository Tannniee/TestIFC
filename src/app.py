"""Compose the local HTTP bridge used by the IFC Viewer desktop shell."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
from app_lifecycle import backend_lifespan
from internal_api import InternalApiSession, DEV_ORIGINS, SESSION_HEADER
from takeoff_service import ModelTakeoffJob, TakeoffService
from version import APP_VERSION


state = BridgeState()
fragment_service = FragmentService()
member_scan_service = MemberScanService()
takeoff_service = TakeoffService()
model_takeoff_job = ModelTakeoffJob(takeoff_service)

app = FastAPI(title="IFC Viewer", version=APP_VERSION, lifespan=backend_lifespan)
app.state.api_session = InternalApiSession()
app.state.model_takeoff_job = model_takeoff_job
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(DEV_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", SESSION_HEADER],
)


app.middleware("http")(app.state.api_session.protect)


app.include_router(create_core_router(state))
app.include_router(create_model_router(fragment_service))
app.include_router(create_mass_router(model_takeoff_job, takeoff_service))
app.include_router(create_idea_router(member_scan_service))
