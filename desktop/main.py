"""Compose the desktop host from focused platform adapters."""

from __future__ import annotations

import multiprocessing
import os
import secrets
from pathlib import Path

from platform_paths import (
    APP_NAME,
    HOST,
    configure_import_paths,
    configure_packaged_cache,
    resolve_dir,
    user_data_dir,
)

configure_import_paths()
configure_packaged_cache()

import webview

from app import app
from desktop_bridges import DesktopApi, SettingsBridge, TaskbarBridge
from logging_config import configure_logging
from server_host import ServerHost
from settings_store import SettingsStore
from version import APP_VERSION


_DIST_DIR = resolve_dir("frontend", "dist")
_ICON_PATH = resolve_dir("desktop", "assets", "app_icon.ico")


def create_desktop_api(logger, data_dir: Path) -> DesktopApi:
    settings = SettingsBridge(SettingsStore(data_dir / "settings.json"))
    return DesktopApi(TaskbarBridge(logger), settings)


def main() -> None:
    data_dir = user_data_dir()
    logger = configure_logging(data_dir / "logs")
    desktop_api = create_desktop_api(logger, data_dir)
    server = ServerHost(
        app,
        host=HOST,
        requested_port=os.environ.get("IFC_VIEWER_PORT"),
        dist_dir=_DIST_DIR,
        startup_token=secrets.token_urlsafe(24),
        logger=logger,
    )

    try:
        base_url = server.start()
        desktop_api._configure_api_session(base_url, app.state.api_session.secret)
        logger.info(
            "Desktop window is starting",
            extra={"event": "app_starting"},
        )
        window = webview.create_window(
            f"{APP_NAME} {APP_VERSION}",
            base_url,
            width=1280,
            height=800,
            min_size=(900, 600),
            js_api=desktop_api,
        )
        desktop_api.attach(window)
        webview.start(icon=str(_ICON_PATH) if _ICON_PATH.exists() else None)
    finally:
        desktop_api.taskbar_clear()
        server.stop()
        logger.info(
            "Desktop application stopped",
            extra={"event": "app_stopped"},
        )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
