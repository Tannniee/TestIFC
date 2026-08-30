"""Material reference, takeoff, CSV, and Excel routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

import excel_quickview
from api_contracts import ErrorResponse, TakeoffRequest
from api_dependencies import require_license_dep
from api_state import ModelTakeoffJob
from ifc_service import IndexPreparingError, NoActiveModelError
from mass import DensityTable
from material_reference import load_material_reference
from takeoff import (
    QUICKVIEW_KG_COLUMNS,
    UnknownElementError,
    model_subject_ids,
    quickview_rows,
    takeoff,
    takeoff_csv,
)


def _takeoff_or_error(request: TakeoffRequest):
    table = DensityTable(request.densityTableRevision, dict(request.densityKgPerM3))
    try:
        subjects = (
            request.globalIds if request.scope == "selection" else model_subject_ids()
        )
        return takeoff(subjects, table, request.tolerance)
    except UnknownElementError as exc:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(error=f"unknown_element:{exc}").model_dump(),
        )
    except IndexPreparingError:
        return JSONResponse(
            status_code=409,
            content=ErrorResponse(error="index_preparing").model_dump(),
        )
    except NoActiveModelError:
        return JSONResponse(
            status_code=409,
            content=ErrorResponse(error="no_active_model").model_dump(),
        )


def _open_quickview(result: dict[str, Any]):
    rows, header_index = quickview_rows(result)
    outcome = excel_quickview.open_table(rows, QUICKVIEW_KG_COLUMNS, header_index)
    if isinstance(outcome, excel_quickview.Unavailable):
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "reason": outcome.reason,
                "detail": outcome.detail,
            },
        )
    return {"status": "opened", "book": outcome.book, "rows": outcome.rows}


def create_mass_router(model_takeoff_job: ModelTakeoffJob) -> APIRouter:
    router = APIRouter()

    def finished_model_takeoff():
        result = model_takeoff_job.result()
        if result is None:
            return JSONResponse(
                status_code=409,
                content=ErrorResponse(error="no_model_takeoff").model_dump(),
            )
        return result

    @router.get("/mass/material-reference", response_model=dict)
    async def get_material_reference():
        return {"references": load_material_reference()}

    @router.post(
        "/mass/takeoff",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def post_takeoff(request: TakeoffRequest):
        return _takeoff_or_error(request)

    @router.post(
        "/mass/takeoff.csv",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def post_takeoff_csv(request: TakeoffRequest):
        result = _takeoff_or_error(request)
        return Response(
            takeoff_csv(result),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="takeoff.csv"'},
        )

    @router.post(
        "/mass/takeoff/open-in-excel",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    def post_takeoff_in_excel(request: TakeoffRequest):
        return _open_quickview(_takeoff_or_error(request))

    @router.post(
        "/mass/takeoff/model",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def post_model_takeoff(request: TakeoffRequest):
        table = DensityTable(
            request.densityTableRevision, dict(request.densityKgPerM3)
        )
        if not model_takeoff_job.start(table, request.tolerance):
            return JSONResponse(
                status_code=409,
                content=ErrorResponse(
                    error="model_takeoff_already_running"
                ).model_dump(),
            )
        return {"status": "running"}

    @router.get("/mass/takeoff/model", response_model=None)
    async def get_model_takeoff():
        return model_takeoff_job.progress()

    @router.get(
        "/mass/takeoff/model.csv",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def get_model_takeoff_csv():
        result = finished_model_takeoff()
        if isinstance(result, JSONResponse):
            return result
        return Response(
            takeoff_csv(result),
            media_type="text/csv; charset=utf-8",
        )

    @router.post(
        "/mass/takeoff/model/open-in-excel",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    def post_model_takeoff_in_excel():
        result = finished_model_takeoff()
        if isinstance(result, JSONResponse):
            return result
        return _open_quickview(result)

    return router
