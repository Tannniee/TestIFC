"""Serve the current backend and cancel owned work when its stop file appears."""
import multiprocessing
from pathlib import Path
import sys
from threading import Thread
from time import sleep

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def main():
    import uvicorn
    import model_cache
    import model_runtime
    server = uvicorn.Server(uvicorn.Config("app:app", host="127.0.0.1", port=int(sys.argv[1]), log_level="warning"))

    def stop():
        stop_file = Path(sys.argv[2])
        while not stop_file.exists():
            sleep(0.25)
        model_runtime._background_indexes.cancel()
        model_cache._retention_jobs.cancel()
        server.should_exit = True

    Thread(target=stop, daemon=True).start()
    try:
        server.run()
    finally:
        model_runtime._background_indexes.cancel()
        model_cache._retention_jobs.cancel()
        model_runtime._background_indexes.wait_idle(30)
        model_cache._retention_jobs.wait_idle(5)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
