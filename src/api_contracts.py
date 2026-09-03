"""HTTP request and response contracts for the local IFC Viewer bridge."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from version import APP_VERSION


SCHEMA_VERSION = 1


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


class ActivateModelResponse(BaseModel):
    ok: bool = True
    path: str
    contentHashSha256: str
    originalFilename: str | None = None
    sizeBytes: int
    loadedAt: str


class CancelModelLoadRequest(BaseModel):
    modelHash: str = Field(pattern="^[0-9a-f]{64}$")
    loadedAt: str = Field(min_length=1, max_length=100)


class StageModelRequest(BaseModel):
    stageId: str = Field(pattern="^[0-9a-f-]{36}$")
    modelHash: str = Field(pattern="^[0-9a-f]{64}$")
    filename: str | None = Field(default=None, max_length=1024)


class StageActionRequest(BaseModel):
    action: Literal["commit", "rollback", "finalize"]


class StageModelResponse(BaseModel):
    stageId: str
    status: Literal["prepared", "committed", "rolled_back", "finalized"]
    model: ActivateModelResponse


class CacheClearRequest(BaseModel):
    scope: Literal["fragments", "all"] = "fragments"


class RetrySemanticRequest(CancelModelLoadRequest):
    attemptId: str = Field(min_length=1, max_length=100)


class SemanticProgress(BaseModel):
    modelHash: str
    attemptId: str
    phase: str
    completed: int
    total: int | None = None
    category: str | None = None
    status: Literal["running", "ready", "error"]
    error: str | None = None
    idleSeconds: float
    stallAfterSeconds: float
    stalled: bool


class ModelRuntimeResponse(BaseModel):
    semanticProgress: SemanticProgress | None = None
    hasActiveModel: bool
    activeModelHash: str | None = None
    activeLoadedAt: str | None = None
    modelResident: bool
    preparing: bool
    prepareError: str | None = None
    hotIndexStatus: Literal["idle", "indexing", "ready", "error"]
    coldIndexStatus: Literal["not_configured", "indexing", "ready", "error"]
    coldIndexError: str | None = None
    storeBacked: bool
    sizeBytes: int
    liveModelMaxBytes: int
    idleSeconds: float


class FragmentStoredResponse(BaseModel):
    ok: bool = True
    modelHash: str
    sizeBytes: int


class RegisterModelRequest(BaseModel):
    path: str
    hash: str


class MemberScanRequest(BaseModel):
    globalIds: list[str] = Field(min_length=1)
    joint: tuple[float, float, float]
    lengthUnit: Literal["m", "mm"]
