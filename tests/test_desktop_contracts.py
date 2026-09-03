from __future__ import annotations

import json
import logging
import os
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
DESKTOP = ROOT / "desktop"
for import_dir in (SRC, DESKTOP):
    if str(import_dir) not in sys.path:
        sys.path.insert(0, str(import_dir))

import desktop_bridges
import logging_config
import platform_paths
import server_host
from desktop_bridges import DesktopApi, SettingsBridge, TaskbarBridge
from logging_config import JsonFormatter, configure_logging
from server_host import ServerHost
from settings_store import SettingsStore


class AppStub:
    def __init__(self) -> None:
        self.mounts: list[tuple[tuple, dict]] = []
        self.routes: list[tuple[tuple, dict]] = []
        self.events: list[str] = []

    def mount(self, *args, **kwargs) -> None:
        self.events.append("mount")
        self.mounts.append((args, kwargs))

    def add_api_route(self, *args, **kwargs) -> None:
        self.events.append("route")
        self.routes.append((args, kwargs))


def logger() -> logging.Logger:
    return logging.getLogger("ifc_viewer.desktop.tests")


class DesktopContractTests(unittest.TestCase):
    def test_constants_and_paths(self):
        self.assertEqual(platform_paths.APP_NAME, "IFC Viewer")
        self.assertEqual(platform_paths.HOST, "127.0.0.1")
        self.assertEqual(platform_paths.resolve_dir("frontend"), ROOT / "frontend")
        with patch.dict(os.environ, {"LOCALAPPDATA": "C:\\LocalData"}):
            self.assertEqual(
                platform_paths.user_data_dir(),
                Path("C:\\LocalData") / "IFC Viewer",
            )

    def test_server_selects_and_validates_ports(self):
        with TemporaryDirectory() as temporary:
            host = ServerHost(
                AppStub(),
                host="127.0.0.1",
                requested_port="8123",
                dist_dir=Path(temporary),
                startup_token="test-token",
                logger=logger(),
            )
            self.assertEqual(host.select_port(), 8123)
            host._requested_port = None
            self.assertEqual(host.select_port(), 0)
            host._requested_port = "70000"
            with self.assertRaisesRegex(ValueError, "between 1 and 65535"):
                host.select_port()

    def test_server_mounts_the_spa_once(self):
        with TemporaryDirectory() as temporary:
            dist = Path(temporary)
            (dist / "index.html").write_text("<html></html>", encoding="utf-8")
            application = AppStub()
            host = ServerHost(
                application,
                host="127.0.0.1",
                requested_port="8123",
                dist_dir=dist,
                startup_token="test-token",
                logger=logger(),
            )
            static = types.SimpleNamespace(kind="static")
            with patch.object(server_host, "StaticFiles", return_value=static) as factory:
                host.mount_spa()
                host.mount_spa()
            factory.assert_called_once_with(directory=str(dist), html=True)
            self.assertEqual(application.mounts, [(('/', static), {"name": "spa"})])

    def test_missing_spa_stops_startup(self):
        with TemporaryDirectory() as temporary:
            host = ServerHost(
                AppStub(),
                host="127.0.0.1",
                requested_port="8123",
                dist_dir=Path(temporary) / "missing",
                startup_token="test-token",
                logger=logger(),
            )
            with self.assertRaisesRegex(SystemExit, "Built SPA not found"):
                host.mount_spa()

    def test_server_start_and_graceful_stop(self):
        calls: list[object] = []

        class FakeServer:
            def __init__(self, config) -> None:
                self.config = config
                self.should_exit = False
                self.force_exit = False

            def run(self, *, sockets) -> None:
                self.socket_address = sockets[0].getsockname()
                calls.append("run")

        with TemporaryDirectory() as temporary:
            dist = Path(temporary)
            (dist / "index.html").write_text("<html></html>", encoding="utf-8")
            application = AppStub()
            host = ServerHost(
                application,
                host="127.0.0.1",
                requested_port="8124",
                dist_dir=dist,
                startup_token="test-token",
                logger=logger(),
            )
            with (
                patch.object(server_host, "StaticFiles", return_value=object()),
                patch.object(server_host.uvicorn, "Config", return_value="config") as config,
                patch.object(server_host, "NoSignalServer", FakeServer),
                patch.object(host, "wait_until_ready", return_value=True),
            ):
                self.assertEqual(host.start(), "http://127.0.0.1:8124")
                running_server = host._server
                host.stop()

            config.assert_called_once_with(
                application,
                host="127.0.0.1",
                port=8124,
                log_level="warning",
            )
            self.assertEqual(calls, ["run"])
            self.assertTrue(running_server.should_exit)
            self.assertIsNone(host._server)
            self.assertIsNone(host._thread)
            self.assertEqual(application.routes[0][0][0], "/_desktop/ready")
            self.assertEqual(application.events, ["route", "mount"])

    def test_desktop_api_preserves_taskbar_and_settings_contract(self):
        events: list[tuple[str, tuple]] = []
        fake_taskbar = types.SimpleNamespace(
            set_progress=lambda *args: events.append(("progress", args)) or True,
            set_indeterminate=lambda *args: events.append(("indeterminate", args)) or True,
            set_error=lambda *args: events.append(("error", args)) or True,
            clear=lambda *args: events.append(("clear", args)) or True,
        )
        with TemporaryDirectory() as temporary, patch.object(
            desktop_bridges,
            "taskbar",
            fake_taskbar,
        ):
            api = DesktopApi(
                TaskbarBridge(logger()),
                SettingsBridge(SettingsStore(Path(temporary) / "settings.json")),
            )
            self.assertFalse(api.taskbar_progress(0.25))
            api.attach(types.SimpleNamespace(native=types.SimpleNamespace(Handle="4321")))
            self.assertTrue(api.taskbar_progress(0.5))
            self.assertTrue(api.taskbar_indeterminate())
            self.assertTrue(api.taskbar_error())
            self.assertTrue(api.taskbar_clear())
            saved = api.save_settings({"locale": "en", "mode": "dark"})
            self.assertEqual(api.load_settings(), saved)
        self.assertEqual(events[0], ("progress", (4321, 0.5)))

    def test_taskbar_cleanup_ignores_a_disposed_native_window(self):
        class DisposedNative:
            @property
            def Handle(self):
                raise RuntimeError("Cannot access a disposed object")

        fake_taskbar = types.SimpleNamespace(
            set_progress=lambda *_: self.fail("disposed window reached taskbar API"),
            set_indeterminate=lambda *_: self.fail("disposed window reached taskbar API"),
            set_error=lambda *_: self.fail("disposed window reached taskbar API"),
            clear=lambda *_: self.fail("disposed window reached taskbar API"),
        )
        with TemporaryDirectory() as temporary, patch.object(
            desktop_bridges,
            "taskbar",
            fake_taskbar,
        ):
            api = DesktopApi(
                TaskbarBridge(logger()),
                SettingsBridge(SettingsStore(Path(temporary) / "settings.json")),
            )
            api.attach(types.SimpleNamespace(native=DisposedNative()))

            self.assertFalse(api.taskbar_clear())
            self.assertFalse(api.taskbar_progress(0.5))

    def test_structured_logging_writes_json_lines(self):
        record = logging.LogRecord(
            "desktop-test",
            logging.INFO,
            __file__,
            1,
            "ready %s",
            ("now",),
            None,
        )
        record.event = "test_ready"
        record.modelHash = "model-a"
        record.operation = "index"
        payload = json.loads(JsonFormatter().format(record))
        self.assertEqual(payload["event"], "test_ready")
        self.assertEqual(payload["appVersion"], "1.0.3")
        self.assertEqual(payload["message"], "ready now")
        self.assertEqual(payload["modelHash"], "model-a")
        self.assertEqual(payload["operation"], "index")

        with TemporaryDirectory() as temporary:
            configured = configure_logging(Path(temporary))
            try:
                configured.info("Desktop test", extra={"event": "test_event"})
                for handler in configured.handlers:
                    handler.flush()
                line = (Path(temporary) / logging_config.LOG_FILENAME).read_text(
                    encoding="utf-8",
                )
                written = json.loads(line)
                self.assertEqual(written["event"], "test_event")
            finally:
                for handler in tuple(configured.handlers):
                    handler.close()
                    configured.removeHandler(handler)

    def test_main_is_a_small_composition_root(self):
        source = (DESKTOP / "main.py").read_text(encoding="utf-8")
        self.assertIn("ServerHost(", source)
        self.assertIn("DesktopApi", source)
        self.assertIn("configure_logging", source)
        self.assertIn("server.stop()", source)
        for forbidden in (
            "class _TaskbarApi",
            "class _NoSignalServer",
            "urllib.request",
            "socket.socket",
            "app.mount(",
        ):
            self.assertNotIn(forbidden, source)
        self.assertLess(len(source.splitlines()), 90)


if __name__ == "__main__":
    unittest.main()
