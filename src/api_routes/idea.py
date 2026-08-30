"""IDEA member scan and tab-separated export routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

import idea_export
from api_contracts import ErrorResponse, MemberScanRequest
from api_dependencies import require_license_dep
from api_state import ScanState
from ifc_service import IndexPreparingError, NoActiveModelError


def _scan_or_error(request: MemberScanRequest):
    try:
        return idea_export.scan(request.globalIds, request.joint, request.lengthUnit)
    except (RuntimeError, LookupError) as exc:
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


def create_idea_router(scan_state: ScanState) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/idea/member-scan",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def post_member_scan(request: MemberScanRequest):
        result = _scan_or_error(request)
        if isinstance(result, JSONResponse):
            return result
        scan_state.set_scan(result)
        return idea_export.scan_wire(result)

    @router.get("/idea/member-scan", response_model=None)
    async def get_member_scan():
        result = scan_state.get_scan()
        if result is None:
            return {"schemaVersion": 1, "hasScan": False}
        return {"hasScan": True, **idea_export.scan_wire(result)}

    @router.get("/idea/member-scan.tsv", response_model=None)
    async def get_member_scan_tsv():
        result = scan_state.get_scan()
        body = (
            idea_export.scan_tsv(result)
            if result is not None
            else "\t".join(idea_export.GETCOMLIST_HEADER)
        )
        return Response(body, media_type="text/tab-separated-values; charset=utf-8")

    @router.delete("/idea/member-scan", response_model=None)
    async def delete_member_scan():
        scan_state.clear_scan()
        return {"ok": True, "hasScan": False}

    return router
