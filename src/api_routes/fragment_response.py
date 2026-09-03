"""Keep cached fragment bytes leased until the response (or disconnect) finishes."""
from fastapi.responses import FileResponse
from fragment_service import FragmentService


class LeasedFragmentResponse(FileResponse):
    def __init__(self, path, model_hash: str, service: FragmentService):
        super().__init__(path, media_type="application/octet-stream")
        self.model_hash = model_hash
        self.service = service

    async def __call__(self, scope, receive, send):
        with self.service.lease_download(self.model_hash):
            return await super().__call__(scope, receive, send)
