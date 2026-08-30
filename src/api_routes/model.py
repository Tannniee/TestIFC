"""Model loading, cache, query, and element routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi import Path as FastApiPath
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

import model_operations
from api_contracts import ErrorResponse, LoadModelResponse, RegisterModelRequest
from api_dependencies import require_license_dep
from ifc_service import (
    HashMismatchError,
    IndexPreparingError,
    NoActiveModelError,
    cached_fragments_file,
    store_cached_fragments_commit,
    store_cached_fragments_start,
)


MODEL_HASH_PATTERN = "^[0-9a-f]{64}$"


def _model_error(exc: Exception):
    if isinstance(exc, IndexPreparingError):
        return JSONResponse(
            status_code=409,
            content=ErrorResponse(error="index_preparing").model_dump(),
        )
    if isinstance(exc, NoActiveModelError):
        return JSONResponse(
            status_code=409,
            content=ErrorResponse(error="no_active_model").model_dump(),
        )


def create_model_router() -> APIRouter:
    router = APIRouter()

    @router.post(
        "/load-model",
        response_model=LoadModelResponse,
        dependencies=[Depends(require_license_dep)],
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
        except Exception as exc:
            print("ERROR /load-model:", exc)
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="materialization_failed").model_dump(),
            )

    @router.get(
        "/model/fragments/{modelHash}",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def get_model_fragments(
        modelHash: str = FastApiPath(pattern=MODEL_HASH_PATTERN),
    ):
        try:
            path = cached_fragments_file(modelHash)
        except FileNotFoundError:
            return JSONResponse(
                status_code=404,
                content=ErrorResponse(error="fragments_not_cached").model_dump(),
            )
        return FileResponse(path, media_type="application/octet-stream")

    @router.post(
        "/model/fragments/{modelHash}",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def post_model_fragments(
        request: Request,
        modelHash: str = FastApiPath(pattern=MODEL_HASH_PATTERN),
    ):
        staging = store_cached_fragments_start(modelHash)
        try:
            with staging.open("wb") as sink:
                async for chunk in request.stream():
                    await run_in_threadpool(sink.write, chunk)
            size = store_cached_fragments_commit(modelHash, staging)
        except ValueError:
            return JSONResponse(
                status_code=400,
                content=ErrorResponse(error="empty_fragments_body").model_dump(),
            )
        except Exception as exc:
            staging.unlink(missing_ok=True)
            print("ERROR /model/fragments:", exc)
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="fragments_store_failed").model_dump(),
            )
        return {"ok": True, "modelHash": modelHash, "sizeBytes": size}

    @router.post(
        "/model/activate/{modelHash}",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
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
            return JSONResponse(
                status_code=404,
                content=ErrorResponse(error="model_not_cached").model_dump(),
            )
        return {"ok": True, **info}

    @router.post(
        "/register-model",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def post_register_model(request: RegisterModelRequest):
        try:
            info = await run_in_threadpool(
                model_operations.register_external_model,
                request.path,
                request.hash,
            )
        except FileNotFoundError as exc:
            return JSONResponse(
                status_code=404,
                content=ErrorResponse(error=str(exc)).model_dump(),
            )
        except HashMismatchError as exc:
            return JSONResponse(
                status_code=409,
                content=ErrorResponse(error=str(exc)).model_dump(),
            )
        return {"ok": True, **info}

    @router.get("/model/runtime", response_model=None)
    async def get_model_runtime():
        return model_operations.runtime_status()

    @router.get(
        "/model/tree",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def get_tree():
        try:
            return model_operations.model_tree()
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception as exc:
            print("ERROR /model/tree:", exc)
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="model_tree_failed").model_dump(),
            )

    @router.get(
        "/model/search",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def search_active_model(
        q: str | None = None,
        ifcType: str | None = None,
        limit: int = 100,
    ):
        try:
            return model_operations.search_active_model(q, ifcType, limit)
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception as exc:
            print("ERROR /model/search:", exc)
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="model_search_failed").model_dump(),
            )

    @router.get(
        "/element/by-express-id/{expressId}",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def get_element_by_express_id(expressId: int):
        try:
            return model_operations.element_by_express_id(expressId)
        except LookupError as exc:
            return JSONResponse(
                status_code=404,
                content=ErrorResponse(error=str(exc)).model_dump(),
            )
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception as exc:
            print("ERROR /element/by-express-id:", exc)
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="extraction_failed").model_dump(),
            )

    @router.get(
        "/element/{globalId}",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def get_element(globalId: str):
        try:
            return model_operations.element_by_global_id(globalId)
        except LookupError as exc:
            return JSONResponse(
                status_code=404,
                content=ErrorResponse(error=str(exc)).model_dump(),
            )
        except (IndexPreparingError, NoActiveModelError) as exc:
            return _model_error(exc)
        except Exception as exc:
            print("ERROR /element:", exc)
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(error="extraction_failed").model_dump(),
            )

    @router.get(
        "/model/materials",
        response_model=None,
        dependencies=[Depends(require_license_dep)],
    )
    async def get_materials():
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
