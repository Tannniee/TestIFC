"""Keep an Engine V2 artifact leased until its file response completes."""

from fastapi.responses import FileResponse

from engine_v2_artifacts import EngineV2ArtifactRepository


class LeasedEngineV2ChunkResponse(FileResponse):
    def __init__(self, path, artifact_key: str, repository: EngineV2ArtifactRepository):
        super().__init__(path, media_type="application/octet-stream")
        self.artifact_key = artifact_key
        self.repository = repository

    async def __call__(self, scope, receive, send):
        with self.repository.lease(self.artifact_key):
            return await super().__call__(scope, receive, send)
