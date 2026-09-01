"""Model loading, cache, query, and element routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Request, UploadFile
from fastapi import Path as FastApiPath
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

import model_operations
from api_contracts import (
    ActivateModelResponse,
    ErrorResponse,
    FragmentStoredResponse,
    LoadModelResponse,
    ModelRuntimeResponse,
    RegisterModelRequest,
)
from api_errors import error_response, model_state_error
from fragment_service import FragmentService
from model_runtime import (
    HashMismatchError,
    IndexPreparingError,
    NoActiveModelError,
)


MODEL_HASH_PATTERN = "^[0-9a-f]{64}$"
FRAGMENT_CACHE_KEY_PATTERN = (
    "^[0-9a-f]{64}\\.fragments-v[0-9]+-(?:full|attributes|minimum)$"
)
logger = logging.getLogger("ifc_viewer.backend.routes.model")


def _model_error(exc: Exception):
    return model_state_error(exc)


def create_model_router(fragment_service: FragmentService) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/load-model",
        response_model=LoadModelResponse,
    )
    async def load_model(file: UploadFile = File(...)):
        try:
            loaded = await run_in_threadpool(
                model_operations.materialize_uploaded_model,
                file.file,
                file.filename,
            )
            return LoadModelResponse(
                modelHash=loaded.model_hash,
                originalFilename=loaded.original_filename,
                sizeBytes=loaded.size_bytes,
            )
        except Exception:
            logger.exception(
                "Model upload materialization failed",
                extra={"event": "model_materialization_failed"},
            )
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="materialization_failed").model_dump(),
            )

    @router.get(
        "/model/fragments/{modelHash}",
        response_model=None,
    )
    async def get_model_fragments(
        modelHash: str = FastApiPath(pattern=FRAGMENT_CACHE_KEY_PATTERN),
    ):
        try:
            path = fragment_service.cached_file(modelHash)
        except FileNotFoundError:
            return error_response(404, "fragments_not_cached")
        return FileResponse(path, media_type="application/octet-stream")

    @router.post(
        "/model/fragments/{modelHash}",
        response_model=FragmentStoredResponse,
    )
    async def post_model_fragments(
        request: Request,
        modelHash: str = FastApiPath(pattern=FRAGMENT_CACHE_KEY_PATTERN),
    ):
        try:
            size = await fragment_service.store_stream(modelHash, request.stream())
        except ValueError:
            return error_response(400, "empty_fragments_body")
        except Exception:
            logger.exception(
                "Fragment cache write failed",
                extra={"event": "fragment_store_failed"},
            )
            return error_response(500, "fragments_store_failed")
        return {"ok": True, "modelHash": modelHash, "sizeBytes": size}

    @router.post(
        "/model/activate/{modelHash}",
        response_model=ActivateModelResponse,
    )
    async def post_model_activate(
        modelHash: str = FastApiPath(pattern=MODEL_HASH_PATTERN),
    ):
        try:
            info = await run_in_threadpool(
                model_operations.activate_cached_model,
                modelHash,
            )
        except (FileNotFoundError, HashMismatchError):
            return error_response(404, "model_not_cached")
        return {"ok": True, **info}

    @router.post(
        "/register-model",
        response_model=None,
    )
    async def post_register_model(request: RegisterModelRequest):
        try:
            info = await run_in_threadpool(
                model_operations.register_external_model,
                request.path,
                request.hash,
            )
        except FileNotFoundError as exc:
            return error_response(404, str(exc))
        except HashMismatchError as exc:
            return error_response(409, str(exc))
        return {"ok": True, **info}

    @router.get("/model/runtime", response_model=ModelRuntimeResponse)
    async def get_model_runtime():
        return model_operations.runtime_status()

    @router.get(
        "/model/tree",
        response_model=None,
    )
    def get_tree():
        try:
            return model_operations.model_tree()
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception:
            logger.exception(
                "Model tree extraction failed",
                extra={"event": "model_tree_failed"},
            )
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="model_tree_failed").model_dump(),
            )

    @router.get(
        "/model/search",
        response_model=None,
    )
    def search_active_model(
        q: str | None = None,
        ifcType: str | None = None,
        limit: int = 100,
    ):
        try:
            return model_operations.search_active_model(q, ifcType, limit)
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception:
            logger.exception(
                "Model search failed",
                extra={"event": "model_search_failed"},
            )
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="model_search_failed").model_dump(),
            )

    @router.get(
        "/element/by-express-id/{expressId}",
        response_model=None,
    )
    def get_element_by_express_id(expressId: int):
        try:
            return model_operations.element_by_express_id(expressId)
        except LookupError as exc:
            return JSONResponse(
                status_code=404,
                content=ErrorResponse(error=str(exc)).model_dump(),
            )
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception:
            logger.exception(
                "Element extraction by express id failed",
                extra={"event": "element_extraction_failed"},
            )
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="extraction_failed").model_dump(),
            )

    @router.get(
        "/element/{globalId}",
        response_model=None,
    )
    def get_element(globalId: str):
        try:
            return model_operations.element_by_global_id(globalId)
        except LookupError as exc:
            return JSONResponse(
                status_code=404,
                content=ErrorResponse(error=str(exc)).model_dump(),
            )
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception:
            logger.exception(
                "Element extraction by global id failed",
                extra={"event": "element_extraction_failed"},
            )
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="extraction_failed").model_dump(),
            )

    @router.get(
        "/model/materials",
        response_model=None,
    )
    def get_materials():
        try:
            uses = model_operations.active_model_materials()
            return {
                "materials": [
                    {
                        "name": use.name,
                        "partCount": use.part_count,
                        "withGeometryCount": use.with_geometry_count,
                    }
                    for use in uses
                ]
            }
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)

    return router
