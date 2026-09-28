"""Model loading, cache, query, and element routes."""

from __future__ import annotations

from api_contracts import RetrySemanticRequest, SaveManualAnchorRequest
from model_runtime import retry_semantic_index
from model_limits import ModelTooLargeError

import logging

from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi import Path as FastApiPath
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

import model_operations
from api_contracts import StageModelRequest, StageActionRequest, StageModelResponse, CacheClearRequest
from api_contracts import (
    ActivateModelResponse,
    CancelModelLoadRequest,
    ErrorResponse,
    FragmentStoredResponse,
    LoadModelResponse,
    ModelRuntimeResponse,
    RegisterModelRequest,
)
from api_errors import error_response, model_state_error
from fragment_service import FragmentService
from api_routes.fragment_response import LeasedFragmentResponse
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

    @router.post("/model/stage", response_model=StageModelResponse)
    def stage_model(request: StageModelRequest):
        try:
            return model_operations.prepare_stage(request.stageId, request.modelHash, request.filename)
        except FileNotFoundError:
            return error_response(404, "model_not_cached")
        except ModelTooLargeError:
            return error_response(413, "ifc_file_exceeds_1_gib_limit")
        except ValueError as error:
            return error_response(409, str(error))

    @router.post("/model/stage/{stageId}", response_model=StageModelResponse)
    def stage_action(request: StageActionRequest, stageId: str = FastApiPath(pattern="^[0-9a-f-]{36}$")):
        try:
            return model_operations.transition_stage(stageId, request.action)
        except ValueError as error:
            return error_response(409, str(error))

    @router.get("/model/cache")
    def get_cache():
        return model_operations.cached_storage()

    @router.post("/model/cache/clear")
    def clear_cache(request: CacheClearRequest):
        return model_operations.cached_storage(request.scope)

    @router.post(
        "/load-model",
        response_model=LoadModelResponse,
    )
    async def load_model(file: UploadFile = File(...), storeOnly: bool = False):
        try:
            loaded = await run_in_threadpool(
                model_operations.materialize_uploaded_model,
                file.file,
                file.filename,
                store_only=storeOnly,
            )
            return LoadModelResponse(
                modelHash=loaded.model_hash,
                originalFilename=loaded.original_filename,
                sizeBytes=loaded.size_bytes,
            )
        except ModelTooLargeError:
            return error_response(413, "ifc_file_exceeds_1_gib_limit")
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
        return LeasedFragmentResponse(path, modelHash, fragment_service)

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
        except ModelTooLargeError:
            return error_response(413, "ifc_file_exceeds_1_gib_limit")
        return {"ok": True, **info}

    @router.post("/model/cancel-load")
    def cancel_model_load(request: CancelModelLoadRequest):
        return {"ok": True, "cancelled": model_operations.cancel_active_load(request.modelHash, request.loadedAt)}

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
        except ModelTooLargeError:
            return error_response(413, "ifc_file_exceeds_1_gib_limit")
        return {"ok": True, **info}

    @router.post("/model/retry-semantic")
    def retry_semantic(request: RetrySemanticRequest):
        if not retry_semantic_index(request.modelHash, request.loadedAt, request.attemptId):
            return JSONResponse(status_code=409, content={"error": "semantic_attempt_changed_or_not_retryable"})
        return {"ok": True}

    @router.get("/model/runtime", response_model=ModelRuntimeResponse)
    def get_model_runtime():
        return model_operations.runtime_status()

    @router.get("/model/georeference", response_model=None)
    def get_model_georeference(modelHash: str = Query(pattern=MODEL_HASH_PATTERN)):
        try:
            return model_operations.model_georeference(modelHash)
        except model_operations.ActiveModelChangedError:
            return error_response(409, "active_model_changed")
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception:
            logger.exception("IFC georeference query failed", extra={"event": "georeference_failed"})
            return error_response(500, "georeference_failed")

    @router.get("/model/browser", response_model=None)
    def get_model_browser(
        modelHash: str = Query(pattern=MODEL_HASH_PATTERN),
        view: str = Query(pattern="^(spatial|systems|types|groups|classification|material)$"),
    ):
        try:
            return model_operations.model_browser(modelHash, view)
        except model_operations.ActiveModelChangedError:
            return error_response(409, "active_model_changed")
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception:
            logger.exception("Model browser query failed", extra={"event": "model_browser_failed"})
            return error_response(500, "model_browser_failed")

    @router.get("/model/semantic-search", response_model=None)
    def search_semantic_values(
        modelHash: str = Query(pattern=MODEL_HASH_PATTERN),
        kind: str = Query(pattern="^(pset|qto)$"),
        setName: str = Query(min_length=1, max_length=128),
        propertyName: str = Query(min_length=1, max_length=128),
        op: str = Query(pattern="^(eq|contains|gt|gte|lt|lte)$"),
        value: str = Query(max_length=256),
        ifcType: str = Query(default="", max_length=80),
        limit: int = Query(default=200, ge=1, le=500),
    ):
        try:
            return model_operations.semantic_search(
                modelHash, kind, setName, propertyName, op, value, ifcType, limit)
        except model_operations.ActiveModelChangedError:
            return error_response(409, "active_model_changed")
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except ValueError as exc:
            return error_response(422, str(exc))
        except Exception:
            logger.exception("Semantic property search failed", extra={"event": "semantic_search_failed"})
            return error_response(500, "semantic_search_failed")

    @router.get("/model/gis-anchor", response_model=None)
    def get_gis_anchor(modelHash: str = Query(pattern=MODEL_HASH_PATTERN)):
        try:
            return model_operations.manual_anchor(modelHash)
        except model_operations.ActiveModelChangedError:
            return error_response(409, "active_model_changed")
        except NoActiveModelError as exc:
            return _model_error(exc)
        except Exception:
            logger.exception("GIS anchor read failed", extra={"event": "gis_anchor_read_failed"})
            return error_response(500, "gis_anchor_read_failed")

    @router.post("/model/gis-anchor", response_model=None)
    def save_gis_anchor(request: SaveManualAnchorRequest):
        try:
            return model_operations.save_manual_anchor(request.modelHash, {
                "longitude": request.longitude, "latitude": request.latitude,
                "elevationMeters": request.elevationMeters,
                "rotationDegrees": request.rotationDegrees % 360,
                "scale": request.scale,
            })
        except model_operations.ActiveModelChangedError:
            return error_response(409, "active_model_changed")
        except NoActiveModelError as exc:
            return _model_error(exc)
        except Exception:
            logger.exception("GIS anchor save failed", extra={"event": "gis_anchor_save_failed"})
            return error_response(500, "gis_anchor_save_failed")

    @router.delete("/model/gis-anchor", response_model=None)
    def delete_gis_anchor(modelHash: str = Query(pattern=MODEL_HASH_PATTERN)):
        try:
            return model_operations.delete_manual_anchor(modelHash)
        except model_operations.ActiveModelChangedError:
            return error_response(409, "active_model_changed")
        except NoActiveModelError as exc:
            return _model_error(exc)
        except Exception:
            logger.exception("GIS anchor delete failed", extra={"event": "gis_anchor_delete_failed"})
            return error_response(500, "gis_anchor_delete_failed")

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

    @router.get("/element/by-express-id/{expressId}/bim", response_model=None)
    def get_bim_element_by_express_id(
        expressId: int,
        modelHash: str = Query(pattern=MODEL_HASH_PATTERN),
    ):
        try:
            return model_operations.bim_element_by_express_id(expressId, modelHash)
        except model_operations.ActiveModelChangedError:
            return error_response(409, "active_model_changed")
        except LookupError:
            return error_response(404, "element_not_found")
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception:
            logger.exception("BIM element query failed", extra={"event": "bim_element_failed"})
            return error_response(500, "bim_element_failed")

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
