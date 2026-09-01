"""Material reference, takeoff, CSV, and Excel routes."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response

from api_contracts import TakeoffRequest
from api_errors import error_response, model_state_error
from model_runtime import IndexPreparingError, NoActiveModelError
from mass import DensityTable
from material_reference import load_material_reference
from takeoff_service import (
    ModelTakeoffJob,
    QuickviewUnavailableError,
    TakeoffService,
    UnknownElementError,
)


def _takeoff_or_error(service: TakeoffService, request: TakeoffRequest):
    table = DensityTable(request.densityTableRevision, dict(request.densityKgPerM3))
    try:
        return service.run(
            request.scope,
            request.globalIds,
            table,
            request.tolerance,
        )
    except UnknownElementError as exc:
        return error_response(404, f"unknown_element:{exc}")
    except (IndexPreparingError, NoActiveModelError) as exc:
        return model_state_error(exc)


def _open_quickview(service: TakeoffService, result: dict):
    try:
        return service.open_quickview(result)
    except QuickviewUnavailableError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "reason": exc.reason,
                "detail": exc.detail,
            },
        )


def create_mass_router(
    model_takeoff_job: ModelTakeoffJob,
    takeoff_service: TakeoffService,
) -> APIRouter:
    router = APIRouter()

    def finished_model_takeoff():
        result = model_takeoff_job.result()
        if result is None:
            return error_response(409, "no_model_takeoff")
        return result

    @router.get("/mass/material-reference", response_model=dict)
    def get_material_reference():
        return {"references": load_material_reference()}

    @router.post("/mass/takeoff", response_model=None)
    def post_takeoff(request: TakeoffRequest):
        return _takeoff_or_error(takeoff_service, request)

    @router.post("/mass/takeoff.csv", response_model=None)
    def post_takeoff_csv(request: TakeoffRequest):
        result = _takeoff_or_error(takeoff_service, request)
        if isinstance(result, JSONResponse):
            return result
        return Response(
            takeoff_service.csv(result),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="takeoff.csv"'},
        )

    @router.post("/mass/takeoff/open-in-excel", response_model=None)
    def post_takeoff_in_excel(request: TakeoffRequest):
        result = _takeoff_or_error(takeoff_service, request)
        if isinstance(result, JSONResponse):
            return result
        return _open_quickview(takeoff_service, result)

    @router.post("/mass/takeoff/model", response_model=None)
    async def post_model_takeoff(request: TakeoffRequest):
        table = DensityTable(
            request.densityTableRevision, dict(request.densityKgPerM3)
        )
        try:
            started = model_takeoff_job.start(table, request.tolerance)
        except (IndexPreparingError, NoActiveModelError) as exc:
            return model_state_error(exc)
        if not started:
            return error_response(409, "model_takeoff_already_running")
        return model_takeoff_job.progress()

    @router.get("/mass/takeoff/model", response_model=None)
    async def get_model_takeoff():
        return model_takeoff_job.progress()

    @router.get("/mass/takeoff/model.csv", response_model=None)
    def get_model_takeoff_csv():
        result = finished_model_takeoff()
        if isinstance(result, JSONResponse):
            return result
        return Response(
            takeoff_service.csv(result),
            media_type="text/csv; charset=utf-8",
        )

    @router.post("/mass/takeoff/model/open-in-excel", response_model=None)
    def post_model_takeoff_in_excel():
        result = finished_model_takeoff()
        if isinstance(result, JSONResponse):
            return result
        return _open_quickview(takeoff_service, result)

    return router
