"""Start background owners with the application and drain them on shutdown."""
from contextlib import asynccontextmanager
import asyncio
import logging
from threading import Event, Thread

import model_cache
import model_runtime

logger = logging.getLogger("ifc_viewer.backend.lifecycle")
IDLE_MODEL_SWEEP_SECONDS = 60.0


def reap_idle_models(stopped: Event) -> None:
    while not stopped.wait(IDLE_MODEL_SWEEP_SECONDS):
        try:
            model_runtime.release_idle_model()
        except Exception:
            logger.exception("Idle model reaper failed", extra={"event": "idle_model_reaper_failed"})


@asynccontextmanager
async def backend_lifespan(app):
    owners = (model_runtime._background_indexes, model_cache._retention_jobs, app.state.model_takeoff_job)
    for owner in owners:
        owner.reopen()
    stopped = Event()
    reaper = Thread(target=reap_idle_models, args=(stopped,), name="idle-model-reaper", daemon=True)
    reaper.start()
    try:
        yield
    finally:
        stopped.set()
        await asyncio.to_thread(reaper.join, 2.0)
        results = await asyncio.gather(*(asyncio.to_thread(owner.shutdown, 12.0) for owner in owners))
        if all(results):
            model_runtime._state.clear()
        else:
            logger.error("Background work exceeded shutdown timeout", extra={"event": "background_shutdown_timeout"})
