"""Application service for cached fragment downloads and streamed uploads."""

from __future__ import annotations

from asyncio import to_thread
from collections.abc import AsyncIterable
from pathlib import Path

import model_cache


class FragmentService:
    def cached_file(self, model_hash: str) -> Path:
        return model_cache.cached_fragments_file(model_hash)

    async def store_stream(
        self,
        model_hash: str,
        chunks: AsyncIterable[bytes],
    ) -> int:
        staging = model_cache.store_cached_fragments_start(model_hash)
        try:
            with staging.open("wb") as sink:
                async for chunk in chunks:
                    await to_thread(sink.write, chunk)
            return await to_thread(
                model_cache.store_cached_fragments_commit,
                model_hash,
                staging,
            )
        except BaseException:
            staging.unlink(missing_ok=True)
            raise
