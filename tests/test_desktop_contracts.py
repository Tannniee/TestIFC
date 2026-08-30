from __future__ import annotations

import importlib.util
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
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


class Server:
    def __init__(self, config):
        self.config = config

    def run(self):
        return None


class Config:
    def __init__(self, app, **kwargs):
        self.app = app
        self.kwargs = kwargs


class StaticFiles:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class AppStub:
    def mount(self, *args, **kwargs):
        return None

    def get(self, *args, **kwargs):
        return lambda function: function


def load_desktop_module():
    stubs = {
        "uvicorn": types.SimpleNamespace(Server=Server, Config=Config),
        "webview": types.SimpleNamespace(
            Window=object,
            create_window=lambda *args, **kwargs: None,
            start=lambda **kwargs: None,
        ),
        "fastapi.staticfiles": types.SimpleNamespace(StaticFiles=StaticFiles),
        "taskbar": types.SimpleNamespace(
            set_progress=lambda *args: True,
            set_indeterminate=lambda *args: True,
            set_error=lambda *args: True,
            clear=lambda *args: True,
        ),
        "app": types.SimpleNamespace(app=AppStub()),
    }
    with patch.dict(sys.modules, stubs):
        spec = importlib.util.spec_from_file_location("desktop_contract_main", DESKTOP / "main.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load desktop/main.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class DesktopContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_desktop_module()

    def test_constants_and_paths(self):
        self.assertEqual(self.module.APP_NAME, "IFC Viewer")
        self.assertEqual(self.module.HOST, "127.0.0.1")
        self.assertEqual(self.module._DIST_DIR, ROOT / "frontend" / "dist")
        with patch.dict(os.environ, {"LOCALAPPDATA": "C:\\LocalData"}):
            self.assertEqual(self.module._user_data_dir(), Path("C:\\LocalData") / "IFC Viewer")

    def test_dynamic_port_selection(self):
        self.module.REQUESTED_PORT = "8123"
        self.assertEqual(self.module._select_port(), 8123)
        self.module.REQUESTED_PORT = None
        selected = self.module._select_port()
        self.assertIsInstance(selected, int)
        self.assertGreater(selected, 0)

    def test_mount_spa_contract(self):
        with TemporaryDirectory() as temporary:
            dist = Path(temporary)
            (dist / "index.html").write_text("<html></html>", encoding="utf-8")
            calls = []
            self.module._DIST_DIR = dist
            self.module.app = types.SimpleNamespace(mount=lambda *args, **kwargs: calls.append((args, kwargs)))
            self.module.StaticFiles = StaticFiles
            self.module._mount_spa()
            self.assertEqual(calls[0][0][0], "/")
            self.assertEqual(calls[0][0][1].kwargs, {"directory": str(dist), "html": True})
            self.assertEqual(calls[0][1], {"name": "spa"})

    def test_missing_spa_stops_startup(self):
        with TemporaryDirectory() as temporary:
            self.module._DIST_DIR = Path(temporary) / "missing"
            with self.assertRaisesRegex(SystemExit, "Built SPA not found"):
                self.module._mount_spa()

    def test_taskbar_api_contract(self):
        events = []
        self.module.taskbar = types.SimpleNamespace(
            set_progress=lambda *args: events.append(("progress", args)) or True,
            set_indeterminate=lambda *args: events.append(("indeterminate", args)) or True,
            set_error=lambda *args: events.append(("error", args)) or True,
            clear=lambda *args: events.append(("clear", args)) or True,
        )
        api = self.module._TaskbarApi()
        self.assertFalse(api.taskbar_progress(0.25))
        api._attach(types.SimpleNamespace(native=types.SimpleNamespace(Handle="4321")))
        self.assertEqual(api._hwnd(), 4321)
        self.assertTrue(api.taskbar_progress("0.5"))
        self.assertTrue(api.taskbar_indeterminate())
        self.assertTrue(api.taskbar_error())
        self.assertTrue(api.taskbar_clear())
        self.assertEqual(events[0], ("progress", (4321, 0.5)))

    def test_server_binding_contract(self):
        calls = []

        class CapturingConfig(Config):
            def __init__(self, app, **kwargs):
                super().__init__(app, **kwargs)
                calls.append(("config", kwargs))

        class CapturingServer(Server):
            def run(self):
                calls.append(("run", self.config.kwargs))

        self.module.uvicorn = types.SimpleNamespace(Config=CapturingConfig)
        self.module._NoSignalServer = CapturingServer
        self.module._serve(8124)
        self.assertEqual(calls[0][1]["host"], "127.0.0.1")
        self.assertEqual(calls[0][1]["port"], 8124)
        self.assertEqual(calls[1][0], "run")


if __name__ == "__main__":
    unittest.main()
