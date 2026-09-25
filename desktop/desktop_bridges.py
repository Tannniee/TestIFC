"""PyWebView adapters for taskbar progress and desktop settings."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import taskbar
import webview
from settings_store import SettingsStore


class TaskbarBridge:
    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._window: Any | None = None
        self._logger = logger

    def attach(self, window: Any | None) -> None:
        self._window = window

    def _hwnd(self) -> int | None:
        window = self._window
        if window is None:
            return None
        try:
            native = getattr(window, "native", None)
            handle = getattr(native, "Handle", None)
            if handle is None:
                return None
            return int(str(handle))
        except (TypeError, ValueError):
            self._logger and self._logger.warning(
                "PyWebView returned an invalid native handle",
                extra={"event": "taskbar_invalid_handle"},
            )
            return None
        except Exception:
            # PyWebView disposes its WinForms Form before webview.start()
            # returns. Reading Form.Handle during final cleanup then raises
            # System.ObjectDisposedException. Taskbar progress is optional, so
            # detach the dead window and let shutdown continue.
            self._window = None
            self._logger and self._logger.info(
                "Taskbar window is no longer available",
                extra={"event": "taskbar_window_unavailable"},
            )
            return None

    def progress(self, ratio: float) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.set_progress(hwnd, float(ratio))

    def indeterminate(self) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.set_indeterminate(hwnd)

    def error(self) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.set_error(hwnd)

    def clear(self) -> bool:
        hwnd = self._hwnd()
        return hwnd is not None and taskbar.clear(hwnd)


class SettingsBridge:
    def __init__(self, store: SettingsStore) -> None:
        self._store = store

    def load(self) -> dict | None:
        return self._store.load()

    def save(self, settings: dict) -> dict:
        return self._store.save(settings)


class DesktopApi:
    """Stable JavaScript API composed from focused desktop bridges."""

    def __init__(
        self,
        taskbar_bridge: TaskbarBridge,
        settings_bridge: SettingsBridge | None,
        model_materializer: Callable[[str], Any] | None = None,
    ) -> None:
        self._taskbar = taskbar_bridge
        self._settings = settings_bridge
        self._model_materializer = model_materializer
        self._window: Any | None = None
        self._api_session: tuple[str, str] | None = None

    def attach(self, window: Any | None) -> None:
        self._window = window
        self._taskbar.attach(window)

    def _configure_api_session(self, origin: str, token: str) -> None:
        self._api_session = (origin, token)

    def get_api_session(self) -> dict[str, str]:
        origin, token = self._viewer_session()
        return {"token": token}

    def _viewer_session(self) -> tuple[str, str]:
        if self._window is None or self._api_session is None:
            raise RuntimeError("Desktop session is not ready")
        origin, token = self._api_session
        current = urlsplit(self._window.get_current_url())
        if f"{current.scheme}://{current.netloc}" != origin or current.path not in ("", "/", "/index.html"):
            raise PermissionError("Desktop session is restricted to the viewer window")
        return origin, token

    def choose_ifc_file(self) -> dict[str, Any] | None:
        """Pick and cache an IFC without routing its bytes through JavaScript."""
        self._viewer_session()
        if self._model_materializer is None:
            raise RuntimeError("Desktop model materializer is unavailable")
        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=("IFC models (*.ifc)",),
        )
        if not selected:
            return None
        path = Path(selected[0] if isinstance(selected, (list, tuple)) else selected)
        if path.suffix.lower() != ".ifc":
            raise ValueError("unsupported_model_file")
        self._taskbar.indeterminate()
        try:
            model = self._model_materializer(str(path))
        finally:
            self._taskbar.clear()
        return {
            "name": model.original_filename or path.name,
            "size": model.size_bytes,
            "modelHash": model.model_hash,
            "origin": "desktop",
        }

    def taskbar_progress(self, ratio: float) -> bool:
        return self._taskbar.progress(ratio)

    def taskbar_indeterminate(self) -> bool:
        return self._taskbar.indeterminate()

    def taskbar_error(self) -> bool:
        return self._taskbar.error()

    def taskbar_clear(self) -> bool:
        return self._taskbar.clear()

    def load_settings(self) -> dict | None:
        return self._settings.load() if self._settings else None

    def save_settings(self, settings: dict) -> dict:
        if self._settings is None:
            raise RuntimeError("Desktop settings store is unavailable")
        return self._settings.save(settings)
