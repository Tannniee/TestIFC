"""Engine V2 artifact build and read routes."""

from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi import Path as FastApiPath

from api_contracts import EngineV2JobResponse
from api_errors import error_response
from api_routes.engine_v2_response import LeasedEngineV2ChunkResponse
from engine_v2_artifacts import ARTIFACT_PROFILE, ArtifactValidationError, EngineV2ArtifactRepository
from engine_v2_jobs import EngineV2JobManager
from model_limits import ModelTooLargeError


MODEL_HASH_PATTERN = "^[0-9a-f]{64}$"
ARTIFACT_KEY_PATTERN = rf"^[0-9a-f]{{64}}\.engine-v2-{re.escape(ARTIFACT_PROFILE)}$"
JOB_ID_PATTERN = "^[0-9a-f]{32}$"
CHUNK_PATTERN = "^(?:positions|meshes|indices|instances|products|materials|instance-materials|normals|positions-f64|semantic-records|semantic-strings|semantic-deep-index|semantic-deep-values)\\.ifcv2$"


def create_engine_v2_router(repository: EngineV2ArtifactRepository, jobs: EngineV2JobManager) -> APIRouter:
    router = APIRouter()

    @router.post("/model/engine-v2/{modelHash}/prepare", response_model=EngineV2JobResponse)
    def prepare(modelHash: str = FastApiPath(pattern=MODEL_HASH_PATTERN)):
        try:
            return jobs.prepare(modelHash)
        except FileNotFoundError:
            return error_response(404, "model_not_cached")
        except ModelTooLargeError as error:
            return error_response(413, str(error))
        except RuntimeError as exc:
            return error_response(503, str(exc))

    @router.get("/model/engine-v2/jobs/{jobId}", response_model=EngineV2JobResponse)
    def status(jobId: str = FastApiPath(pattern=JOB_ID_PATTERN)):
        try:
            return jobs.status(jobId)
        except KeyError:
            return error_response(404, "engine_v2_job_not_found")

    @router.delete("/model/engine-v2/jobs/{jobId}", response_model=EngineV2JobResponse)
    def cancel(jobId: str = FastApiPath(pattern=JOB_ID_PATTERN)):
        try:
            return jobs.cancel(jobId)
        except KeyError:
            return error_response(404, "engine_v2_job_not_found")

    @router.get("/model/engine-v2/artifacts/{artifactKey}/manifest", response_model=None)
    def manifest(artifactKey: str = FastApiPath(pattern=ARTIFACT_KEY_PATTERN)):
        try:
            return repository.manifest(artifactKey)
        except FileNotFoundError:
            return error_response(404, "engine_v2_artifact_not_cached")
        except (ArtifactValidationError, OSError):
            return error_response(409, "engine_v2_artifact_invalid")

    @router.get("/model/engine-v2/artifacts/{artifactKey}/chunks/{file}", response_model=None)
    def chunk(
        artifactKey: str = FastApiPath(pattern=ARTIFACT_KEY_PATTERN),
        file: str = FastApiPath(pattern=CHUNK_PATTERN),
    ):
        try:
            path = repository.chunk_path(artifactKey, file)
        except FileNotFoundError:
            return error_response(404, "engine_v2_chunk_not_found")
        except (ArtifactValidationError, OSError):
            return error_response(409, "engine_v2_artifact_invalid")
        return LeasedEngineV2ChunkResponse(path, artifactKey, repository)

    return router
