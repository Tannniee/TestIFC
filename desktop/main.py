"""Run the FastAPI bridge and packaged SPA in one desktop process."""

from __future__ import annotations

import mimetypes
import multiprocessing
import os
import secrets
import socket
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

APP_NAME = "IFC Viewer"
HOST = "127.0.0.1"
REQUESTED_PORT = os.environ.get("IFC_VIEWER_PORT")
_STARTUP_TOKEN = secrets.token_urlsafe(24)


def _user_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / APP_NAME


def _resolve_dir(*parts: str) -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass).joinpath(*parts)
    return Path(__file__).resolve().parents[1].joinpath(*parts)


# Backend modules use flat imports, so source and packaged runs add these two
# application directories explicitly.
_BACKEND_DIR = _resolve_dir("src")
_VENDOR_DIR = _resolve_dir("vendor")
for import_dir in (_VENDOR_DIR, _BACKEND_DIR):
    if str(import_dir) not in sys.path:
        sys.path.insert(0, str(import_dir))

if getattr(sys, "frozen", False):
    os.environ.setdefault(
        "IFC_MODEL_CACHE_DIR", str(_user_data_dir() / "model_cache")
    )

import uvicorn
import webview
from fastapi.staticfiles import StaticFiles

import taskbar
from app import app
from settings_store import SettingsStore
from version import APP_VERSION

_SETTINGS_STORE = SettingsStore(_user_data_dir() / "settings.json")


@app.get("/_desktop/ready", include_in_schema=False)
def _desktop_ready() -> dict[str, str]:
    """Identify this desktop process, not another bridge on the same port."""

    return {"token": _STARTUP_TOKEN}

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")

_DIST_DIR = _resolve_dir("frontend", "dist")
_ICON_PATH = _resolve_dir("desktop", "assets", "app_icon.ico")


class _NoSignalServer(uvicorn.Server):
    """Disable signal handlers because the server runs in a daemon thread."""

    def install_signal_handlers(self) -> None:
        return None


def _mount_spa() -> None:
    if not (_DIST_DIR / "index.html").exists():
        raise SystemExit(
            f"Built SPA not found at {_DIST_DIR}. "
            "Run `npm run build` in frontend/ first."
        )
    app.mount(
        "/",
        StaticFiles(directory=str(_DIST_DIR), html=True),
        name="spa",
    )


def _select_port() -> int:
    if REQUESTED_PORT is not None:
        return int(REQUESTED_PORT)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return int(probe.getsockname()[1])


def _wait_until_up(base_url: str, timeout_s: float = 15.0) -> bool:
    deadline_checks = int(timeout_s * 10)
    for _ in range(deadline_checks):
        try:
            with urllib.request.urlopen(f"{base_url}/_desktop/ready", timeout=1) as response:
                payload = response.read().decode("utf-8")
                if response.status == 200 and _STARTUP_TOKEN in payload:
                    return True
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        threading.Event().wait(0.1)
    return False


def _serve(port: int) -> None:
    config = uvicorn.Config(app, host=HOST, port=port, log_level="warning")
    _NoSignalServer(config).run()


class _TaskbarApi:
    """Expose taskbar progress controls to the SPA through pywebview."""

    def __init__(self) -> None:
        self._window: webview.Window | None = None

    def _attach(self, window: webview.Window | None) -> None:
        self._window = window

    def _hwnd(self) -> int | None:
        if self._window is None:
            return None
        native = getattr(self._window, "native", None)
        handle = getattr(native, "Handle", None)
        if handle is None:
            return None
        return int(str(handle))

    def taskbar_progress(self, ratio: float) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.set_progress(hwnd, float(ratio))

    def taskbar_indeterminate(self) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.set_indeterminate(hwnd)

    def taskbar_error(self) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.set_error(hwnd)

    def taskbar_clear(self) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.clear(hwnd)

    def load_settings(self) -> dict | None:
        return _SETTINGS_STORE.load()

    def save_settings(self, settings: dict) -> dict:
        return _SETTINGS_STORE.save(settings)


def main() -> None:
    _mount_spa()
    port = _select_port()
    base_url = f"http://{HOST}:{port}"
    server_thread = threading.Thread(target=_serve, args=(port,), name="bridge", daemon=True)
    server_thread.start()

    if not _wait_until_up(base_url):
        raise SystemExit(f"Bridge did not come up on {base_url} within timeout.")

    api = _TaskbarApi()
    window = webview.create_window(
        f"{APP_NAME} {APP_VERSION}",
        base_url,
        width=1280,
        height=800,
        min_size=(900, 600),
        js_api=api,
    )
    api._attach(window)
    webview.start(icon=str(_ICON_PATH) if _ICON_PATH.exists() else None)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
