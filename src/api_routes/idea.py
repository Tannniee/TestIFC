"""IDEA member scan and tab-separated export routes."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from api_contracts import MemberScanRequest
from api_errors import error_response, model_state_error
from member_scan_service import MemberScanService
from model_runtime import IndexPreparingError, NoActiveModelError


def _scan_or_error(service: MemberScanService, request: MemberScanRequest):
    try:
        return service.run(request.globalIds, request.joint, request.lengthUnit)
    except (RuntimeError, LookupError) as exc:
        return error_response(404, f"unknown_element:{exc}")
    except (IndexPreparingError, NoActiveModelError) as exc:
        return model_state_error(exc)


def create_idea_router(scan_service: MemberScanService) -> APIRouter:
    router = APIRouter()

    @router.post("/idea/member-scan", response_model=None)
    def post_member_scan(request: MemberScanRequest):
        return _scan_or_error(scan_service, request)

    @router.get("/idea/member-scan", response_model=None)
    async def get_member_scan():
        return scan_service.current()

    @router.get("/idea/member-scan.tsv", response_model=None)
    def get_member_scan_tsv():
        return Response(
            scan_service.tsv(),
            media_type="text/tab-separated-values; charset=utf-8",
        )

    @router.delete("/idea/member-scan", response_model=None)
    async def delete_member_scan():
        return scan_service.clear()

    return router
