"""PyWebView adapters for taskbar progress and desktop settings."""

from __future__ import annotations

import logging
from typing import Any

import taskbar
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

    def __init__(self, taskbar_bridge: TaskbarBridge, settings_bridge: SettingsBridge) -> None:
        self._taskbar = taskbar_bridge
        self._settings = settings_bridge

    def attach(self, window: Any | None) -> None:
        self._taskbar.attach(window)

    def taskbar_progress(self, ratio: float) -> bool:
        return self._taskbar.progress(ratio)

    def taskbar_indeterminate(self) -> bool:
        return self._taskbar.indeterminate()

    def taskbar_error(self) -> bool:
        return self._taskbar.error()

    def taskbar_clear(self) -> bool:
        return self._taskbar.clear()

    def load_settings(self) -> dict | None:
        return self._settings.load()

    def save_settings(self, settings: dict) -> dict:
        return self._settings.save(settings)
