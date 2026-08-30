"""Local HTTP bridge used by the IFC Viewer desktop shell."""

from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock, Thread
from time import sleep
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi import Path as FastApiPath
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool

import excel_quickview
import idea_export
import license_gate
from ifc_service import (
    HashMismatchError,
    IndexPreparingError,
    NoActiveModelError,
    cached_fragments_file,
    cached_model_file,
    extract_element,
    extract_element_by_express_id,
    live_model_status,
    materialize_model_stream,
    open_active_model,
    register_model,
    release_idle_model,
    store_cached_fragments_commit,
    store_cached_fragments_start,
)
from mass import DensityTable
from mass_facts import survey_materials
from material_reference import load_material_reference
from model_query import get_model_tree, search_model
from takeoff import (
    QUICKVIEW_KG_COLUMNS,
    UnknownElementError,
    model_subject_ids,
    quickview_rows,
    takeoff,
    takeoff_csv,
)
from version import APP_VERSION

SCHEMA_VERSION = 1
LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost", "testclient"}
ALLOWED_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}


class ModelRef(BaseModel):
    id: str | None = None
    name: str | None = None
    path: str | None = None


class ElementRef(BaseModel):
    globalId: str | None = None
    expressId: int | None = None
    localId: int | None = None
    ifcType: str | None = None
    objectType: str | None = None
    description: str | None = None
    name: str | None = None


class SelectionMeta(BaseModel):
    status: str = "selected"
    selectedAt: str


class SelectionPayload(BaseModel):
    schemaVersion: int = SCHEMA_VERSION
    source: str = "thatopen"
    model: ModelRef = Field(default_factory=ModelRef)
    element: ElementRef = Field(default_factory=ElementRef)
    selection: SelectionMeta
    preview: dict[str, Any] = Field(default_factory=dict)


class SelectionResponse(BaseModel):
    ok: bool = True
    schemaVersion: int = SCHEMA_VERSION
    hasSelection: bool
    data: SelectionPayload | None = None
    updatedAt: str | None = None
    globalId: str | None = None
    expressId: int | None = None
    ifcType: str | None = None
    objectType: str | None = None
    name: str | None = None
    modelName: str | None = None


class HealthResponse(BaseModel):
    ok: bool = True
    service: str = "ifc-selection-bridge"
    schemaVersion: int = SCHEMA_VERSION
    appVersion: str = APP_VERSION
    hasSelection: bool


class ErrorResponse(BaseModel):
    ok: bool = False
    error: str


class TakeoffRequest(BaseModel):
    scope: Literal["selection", "model"] = "selection"
    globalIds: list[str] = Field(default_factory=list)
    densityTableRevision: str = "none"
    densityKgPerM3: dict[str, float] = Field(default_factory=dict)
    tolerance: float = Field(0.05, gt=0.0, lt=1.0)

    @model_validator(mode="after")
    def _selection_names_what_it_selects(self):
        if self.scope == "selection" and not self.globalIds:
            raise ValueError("scope 'selection' needs at least one globalId")
        return self


class LoadModelResponse(BaseModel):
    ok: bool = True
    modelHash: str
    originalFilename: str | None = None
    sizeBytes: int


class RegisterModelRequest(BaseModel):
    path: str
    hash: str


class BridgeState:
    def __init__(self):
        self._lock = Lock()
        self._selection: SelectionPayload | None = None
        self._updated_at: str | None = None

    def set_selection(self, selection: SelectionPayload) -> SelectionResponse:
        with self._lock:
            self._selection = selection
            self._updated_at = now_utc()
            return make_selection_response(self._selection, self._updated_at)

    def get_selection(self) -> SelectionResponse:
        with self._lock:
            return make_selection_response(self._selection, self._updated_at)

    def clear_selection(self) -> SelectionResponse:
        with self._lock:
            self._selection = None
            self._updated_at = now_utc()
            return make_selection_response(None, self._updated_at)

    def has_selection(self) -> bool:
        with self._lock:
            return self._selection is not None


def now_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def make_selection_response(
    selection: SelectionPayload | None, updated_at: str | None
) -> SelectionResponse:
    if selection is None:
        return SelectionResponse(hasSelection=False, updatedAt=updated_at)
    return SelectionResponse(
        hasSelection=True,
        data=selection,
        updatedAt=updated_at,
        globalId=selection.element.globalId,
        expressId=selection.element.expressId,
        ifcType=selection.element.ifcType,
        objectType=selection.element.objectType,
        name=selection.element.name,
        modelName=selection.model.name,
    )


class ScanState:
    def __init__(self):
        self._lock = Lock()
        self._scan: idea_export.Scan | None = None

    def set_scan(self, scan: idea_export.Scan) -> None:
        with self._lock:
            self._scan = scan

    def get_scan(self) -> idea_export.Scan | None:
        with self._lock:
            return self._scan

    def clear_scan(self) -> None:
        with self._lock:
            self._scan = None


class ModelTakeoffJob:
    def __init__(self):
        self._lock = Lock()
        self._status = "idle"
        self._done = 0
        self._total = 0
        self._result: dict[str, Any] | None = None
        self._error = ""

    def start(self, table: DensityTable, tolerance: float) -> bool:
        with self._lock:
            if self._status == "running":
                return False
            self._status, self._done, self._total, self._result, self._error = (
                "running",
                0,
                0,
                None,
                "",
            )
            Thread(
                target=self._run,
                args=(table, tolerance),
                name="model-takeoff",
                daemon=True,
            ).start()
            return True

    def _run(self, table: DensityTable, tolerance: float) -> None:
        try:
            result = takeoff(
                model_subject_ids(), table, tolerance, on_progress=self._advance
            )
        except Exception as exc:
            with self._lock:
                self._status = "failed"
                self._error = f"{type(exc).__name__}: {exc}"
            return
        with self._lock:
            self._status = "done"
            self._result = result

    def _advance(self, done: int, total: int) -> None:
        with self._lock:
            self._done = done
            self._total = total

    def progress(self) -> dict[str, Any]:
        with self._lock:
            return {
                "status": self._status,
                "done": self._done,
                "total": self._total,
                "error": self._error,
            }

    def result(self) -> dict[str, Any] | None:
        with self._lock:
            return self._result


IDLE_MODEL_SWEEP_SECONDS = 60.0


def _reap_idle_model() -> None:
    while True:
        sleep(IDLE_MODEL_SWEEP_SECONDS)
        try:
            release_idle_model()
        except Exception:
            pass


state = BridgeState()
scan_state = ScanState()
model_takeoff_job = ModelTakeoffJob()
app = FastAPI(title="IFC Viewer", version=APP_VERSION)
Thread(target=_reap_idle_model, name="idle-model-reaper", daemon=True).start()

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


def require_license_dep() -> None:
    try:
        license_gate.require_license()
    except license_gate.LicenseError as exc:
        raise HTTPException(
            status_code=403,
            detail={"error": "not_licensed", "message": str(exc)},
        ) from exc


@app.get("/auth/status", response_model=dict)
async def auth_status():
    return license_gate.status()


@app.post("/auth/login", response_model=dict)
async def auth_login():
    return license_gate.login()


@app.post("/auth/logout", response_model=dict)
async def auth_logout():
    license_gate.logout()
    return {"ok": True}


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(hasSelection=state.has_selection())


@app.get("/selection", response_model=SelectionResponse)
async def get_selection():
    return state.get_selection()


@app.post("/selection", response_model=SelectionResponse)
async def post_selection(selection: SelectionPayload):
    return state.set_selection(selection)


@app.delete("/selection", response_model=SelectionResponse)
async def delete_selection():
    return state.clear_selection()


@app.post(
    "/load-model",
    response_model=LoadModelResponse,
    dependencies=[Depends(require_license_dep)],
)
async def load_model(file: UploadFile = File(...)):
    try:
        info = await run_in_threadpool(
            materialize_model_stream, file.file, file.filename, True
        )
        return LoadModelResponse(
            modelHash=info["contentHashSha256"],
            originalFilename=info["originalFilename"],
            sizeBytes=info["sizeBytes"],
        )
    except Exception as exc:
        print("ERROR /load-model:", exc)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(error="materialization_failed").model_dump(),
        )


_MODEL_HASH_PATTERN = "^[0-9a-f]{64}$"


@app.get(
    "/model/fragments/{modelHash}",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def get_model_fragments(
    modelHash: str = FastApiPath(pattern=_MODEL_HASH_PATTERN),
):
    try:
        path = cached_fragments_file(modelHash)
    except FileNotFoundError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(error="fragments_not_cached").model_dump(),
        )
    return FileResponse(path, media_type="application/octet-stream")


@app.post(
    "/model/fragments/{modelHash}",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def post_model_fragments(
    request: Request,
    modelHash: str = FastApiPath(pattern=_MODEL_HASH_PATTERN),
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


@app.post(
    "/model/activate/{modelHash}",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def post_model_activate(
    modelHash: str = FastApiPath(pattern=_MODEL_HASH_PATTERN),
):
    try:
        path = cached_model_file(modelHash)
        info = await run_in_threadpool(register_model, str(path), modelHash, True)
    except (FileNotFoundError, HashMismatchError):
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(error="model_not_cached").model_dump(),
        )
    return {"ok": True, **info}


@app.post(
    "/register-model",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def post_register_model(request: RegisterModelRequest):
    try:
        info = await run_in_threadpool(register_model, request.path, request.hash, True)
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


@app.get("/model/runtime", response_model=None)
async def get_model_runtime():
    return live_model_status()


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


@app.get(
    "/model/tree",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def get_tree():
    try:
        return get_model_tree()
    except (IndexPreparingError, NoActiveModelError) as exc:
        return _model_error(exc)
    except Exception as exc:
        print("ERROR /model/tree:", exc)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(error="model_tree_failed").model_dump(),
        )


@app.get(
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
        return search_model(q=q, ifc_type=ifcType, limit=limit)
    except (IndexPreparingError, NoActiveModelError) as exc:
        return _model_error(exc)
    except Exception as exc:
        print("ERROR /model/search:", exc)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(error="model_search_failed").model_dump(),
        )


@app.get(
    "/element/by-express-id/{expressId}",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def get_element_by_express_id(expressId: int):
    try:
        return extract_element_by_express_id(expressId)
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


@app.get(
    "/element/{globalId}",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def get_element(globalId: str):
    try:
        return extract_element(globalId)
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


def _takeoff_or_error(request: TakeoffRequest):
    table = DensityTable(request.densityTableRevision, dict(request.densityKgPerM3))
    try:
        subjects = request.globalIds if request.scope == "selection" else model_subject_ids()
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


@app.get(
    "/model/materials",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def get_materials():
    try:
        uses = survey_materials(open_active_model())
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


@app.get("/mass/material-reference", response_model=dict)
async def get_material_reference():
    return {"references": load_material_reference()}


@app.post(
    "/mass/takeoff",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def post_takeoff(request: TakeoffRequest):
    return _takeoff_or_error(request)


@app.post(
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


class MemberScanRequest(BaseModel):
    globalIds: list[str] = Field(min_length=1)
    joint: tuple[float, float, float]
    lengthUnit: Literal["m", "mm"]


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


@app.post(
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


@app.get("/idea/member-scan", response_model=None)
async def get_member_scan():
    result = scan_state.get_scan()
    if result is None:
        return {"schemaVersion": 1, "hasScan": False}
    return {"hasScan": True, **idea_export.scan_wire(result)}


@app.get("/idea/member-scan.tsv", response_model=None)
async def get_member_scan_tsv():
    result = scan_state.get_scan()
    body = (
        idea_export.scan_tsv(result)
        if result is not None
        else "\t".join(idea_export.GETCOMLIST_HEADER)
    )
    return Response(body, media_type="text/tab-separated-values; charset=utf-8")


@app.delete("/idea/member-scan", response_model=None)
async def delete_member_scan():
    scan_state.clear_scan()
    return {"ok": True, "hasScan": False}


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


@app.post(
    "/mass/takeoff/open-in-excel",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
def post_takeoff_in_excel(request: TakeoffRequest):
    return _open_quickview(_takeoff_or_error(request))


@app.post(
    "/mass/takeoff/model",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def post_model_takeoff(request: TakeoffRequest):
    table = DensityTable(request.densityTableRevision, dict(request.densityKgPerM3))
    if not model_takeoff_job.start(table, request.tolerance):
        return JSONResponse(
            status_code=409,
            content=ErrorResponse(error="model_takeoff_already_running").model_dump(),
        )
    return {"status": "running"}


@app.get("/mass/takeoff/model", response_model=None)
async def get_model_takeoff():
    return model_takeoff_job.progress()


def _finished_model_takeoff():
    result = model_takeoff_job.result()
    if result is None:
        return JSONResponse(
            status_code=409,
            content=ErrorResponse(error="no_model_takeoff").model_dump(),
        )
    return result


@app.get(
    "/mass/takeoff/model.csv",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
async def get_model_takeoff_csv():
    result = _finished_model_takeoff()
    if isinstance(result, JSONResponse):
        return result
    return Response(
        takeoff_csv(result),
        media_type="text/csv; charset=utf-8",
    )


@app.post(
    "/mass/takeoff/model/open-in-excel",
    response_model=None,
    dependencies=[Depends(require_license_dep)],
)
def post_model_takeoff_in_excel():
    result = _finished_model_takeoff()
    if isinstance(result, JSONResponse):
        return result
    return _open_quickview(result)
