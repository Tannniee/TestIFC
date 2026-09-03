from __future__ import annotations
import asyncio
import logging
import socket
import sys
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "src"), str(ROOT / "desktop")]
from background_tasks import LatestTaskRunner
from desktop_bridges import DesktopApi
from server_host import ServerHost
import model_cache
import app_lifecycle


class FoundationLifecycleTests(unittest.TestCase):
    def test_shutdown_cancels_active_discards_pending_and_refuses_new_work(self):
        started = threading.Event()
        stopped = threading.Event()
        runner = LatestTaskRunner("owned-test")
        def work(cancelled):
            started.set()
            cancelled.wait(2)
            stopped.set()
        runner.submit("a", work)
        self.assertTrue(started.wait(2))
        runner.submit("b", lambda _: None)
        self.assertTrue(runner.shutdown(2))
        self.assertTrue(stopped.is_set())
        self.assertFalse(runner.contains("b"))
        with self.assertRaises(RuntimeError):
            runner.submit("c", lambda _: None)
        runner.reopen()
        runner.submit("c", lambda _: None)
        self.assertTrue(runner.shutdown(2))

    def test_reaper_is_owned_by_each_lifespan(self):
        async def run():
            owners = [LatestTaskRunner(f"lifespan-{i}") for i in range(3)]
            app = SimpleNamespace(state=SimpleNamespace(model_takeoff_job=owners[2]))
            with patch.object(app_lifecycle.model_runtime, "_background_indexes", owners[0]), patch.object(model_cache, "_retention_jobs", owners[1]):
                for _ in range(2):
                    async with app_lifecycle.backend_lifespan(app):
                        self.assertEqual(sum(t.name == "idle-model-reaper" for t in threading.enumerate()), 1)
                    self.assertFalse(any(t.name == "idle-model-reaper" for t in threading.enumerate()))
        asyncio.run(run())

    def test_bound_socket_is_handed_to_uvicorn_without_releasing_port(self):
        import server_host
        entered = threading.Event()
        release = threading.Event()
        class FakeServer:
            should_exit = False
            force_exit = False
            def __init__(self, config): pass
            def run(self, *, sockets):
                entered.set()
                release.wait(2)
        with TemporaryDirectory() as temporary:
            host = ServerHost(SimpleNamespace(), host="127.0.0.1", requested_port=None, dist_dir=Path(temporary), startup_token="probe", logger=logging.getLogger("test"))
            with patch.object(host, "mount_spa"), patch.object(host, "_install_readiness_route"), patch.object(host, "wait_until_ready", return_value=True), patch.object(server_host, "NoSignalServer", FakeServer):
                try:
                    host.start()
                    self.assertTrue(entered.wait(2))
                    self.assertGreater(host.port, 0)
                    with socket.socket() as competitor:
                        with self.assertRaises(OSError):
                            competitor.bind(("127.0.0.1", host.port))
                finally:
                    release.set()
                    host.stop()
                self.assertIsNone(host._socket)

    def test_desktop_session_is_only_available_to_its_own_viewer(self):
        api = DesktopApi(SimpleNamespace(attach=lambda _: None), None)
        api._configure_api_session("http://127.0.0.1:8001", "s" * 32)
        for url in ("https://evil.example", "http://127.0.0.1:8002/", "http://127.0.0.1:8001/vendor/a.html"):
            api.attach(SimpleNamespace(get_current_url=lambda: url))
            with self.assertRaises(PermissionError):
                api.get_api_session()
        api.attach(SimpleNamespace(get_current_url=lambda: "http://127.0.0.1:8001/"))
        self.assertEqual(api.get_api_session(), {"token": "s" * 32})

    def test_cache_removal_failure_is_logged_and_missing_entry_is_quiet(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / ("a" * 64 + ".frag")
            path.write_bytes(b"data")
            with patch.object(Path, "unlink", side_effect=PermissionError("locked")), self.assertLogs(model_cache.logger, "WARNING") as logs:
                model_cache._remove_cache_path(path)
            record = logs.records[0]
            self.assertEqual(record.event, "cache_remove_failed")
            self.assertEqual(record.cachePath, str(path))
            self.assertTrue(path.exists())
            path.unlink()
            with self.assertNoLogs(model_cache.logger):
                model_cache._remove_cache_path(path)
