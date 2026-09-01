from __future__ import annotations

import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import fragment_service
import excel_quickview
import idea_export
import member_scan_service
import model_cache
from mass import DensityTable
from takeoff_service import ModelTakeoffJob, TakeoffService


class TakeoffApplicationTests(unittest.TestCase):
    def test_service_resolves_selection_and_model_scopes(self):
        calls = []
        session = object()

        def run(actual_session, subjects, table, tolerance, on_progress=None):
            self.assertIs(actual_session, session)
            calls.append((list(subjects), table.revision, tolerance, on_progress))
            return {"subjects": list(subjects)}

        service = TakeoffService(
            lambda actual: ["MODEL-A", "MODEL-B"],
            run,
            lambda **_kwargs: nullcontext(session),
        )
        table = DensityTable("steel", {})
        self.assertEqual(
            service.run("selection", ["SELECTED"], table, 0.05)["subjects"],
            ["SELECTED"],
        )
        self.assertEqual(service.run_model(table, 0.10)["subjects"], ["MODEL-A", "MODEL-B"])
        self.assertEqual(calls[0][:3], (["SELECTED"], "steel", 0.05))
        self.assertEqual(calls[1][:3], (["MODEL-A", "MODEL-B"], "steel", 0.10))

    def test_model_takeoff_job_records_success_and_failure(self):
        class Lease:
            ref = type("Ref", (), {"model_hash": "model-a"})()

        result = {"ok": True, "subjects": []}
        successful = TakeoffService(
            lambda _session: [],
            lambda *args, **kwargs: result,
            lambda **_kwargs: nullcontext(object()),
        )
        job = ModelTakeoffJob(successful)
        job._run(DensityTable("steel", {}), 0.05, Lease())
        self.assertEqual(job.progress()["status"], "done")
        self.assertIs(job.result(), result)

        def fail(*args, **kwargs):
            raise RuntimeError("failed")

        failed = ModelTakeoffJob(
            TakeoffService(
                lambda _session: [],
                fail,
                lambda **_kwargs: nullcontext(object()),
            )
        )
        failed._run(DensityTable("steel", {}), 0.05, Lease())
        self.assertEqual(failed.progress()["status"], "failed")
        self.assertIn("RuntimeError: failed", failed.progress()["error"])
        self.assertIsNone(failed.result())

    def test_model_takeoff_job_captures_the_lease_before_thread_start(self):
        events = []

        class Lease:
            ref = type("Ref", (), {"model_hash": "captured-hash"})()

            def release(self):
                events.append("released")

        class Thread:
            def __init__(self, *, target, args, **_kwargs):
                self.args = args
                events.append(("thread-created", args[2]))

            def start(self):
                events.append("thread-started")

        job = ModelTakeoffJob()
        with (
            patch("takeoff_service.lease_active_model", side_effect=lambda: events.append("leased") or Lease()),
            patch("takeoff_service.Thread", Thread),
        ):
            self.assertTrue(job.start(DensityTable("steel", {}), 0.05))

        self.assertEqual(events[0], "leased")
        self.assertEqual(events[-1], "thread-started")
        self.assertEqual(job.progress()["modelHash"], "captured-hash")

    def test_model_takeoff_job_returns_to_idle_when_capture_fails(self):
        job = ModelTakeoffJob()
        with patch(
            "takeoff_service.lease_active_model",
            side_effect=RuntimeError("capture failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "capture failed"):
                job.start(DensityTable("steel", {}), 0.05)
        self.assertEqual(job.progress()["status"], "idle")

    def test_quickview_maps_excel_outcomes_at_the_application_boundary(self):
        service = TakeoffService()
        with (
            patch.object(service, "quickview", return_value=([["Mass"], [12.5]], 0)),
            patch.object(
                excel_quickview,
                "open_table",
                return_value=excel_quickview.Opened("Book1", 2),
            ),
        ):
            self.assertEqual(
                service.open_quickview({}),
                {"status": "opened", "book": "Book1", "rows": 2},
            )


class MemberScanApplicationTests(unittest.TestCase):
    def test_service_owns_the_latest_scan_lifecycle(self):
        service = member_scan_service.MemberScanService()
        scan = idea_export.Scan((), (), "N1", "m")
        with (
            patch.object(member_scan_service.idea_export, "scan", return_value=scan),
            patch.object(member_scan_service.idea_export, "scan_wire", return_value={"schemaVersion": 1, "rows": []}),
            patch.object(member_scan_service.idea_export, "scan_tsv", return_value="header\n"),
            patch.object(
                member_scan_service,
                "open_model_session",
                return_value=nullcontext(object()),
            ),
        ):
            self.assertFalse(service.current()["hasScan"])
            self.assertEqual(service.run(["A"], (0, 0, 0), "m")["rows"], [])
            self.assertTrue(service.current()["hasScan"])
            self.assertEqual(service.tsv(), "header\n")
            self.assertFalse(service.clear()["hasScan"])


class FragmentApplicationTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_is_committed_and_failed_stream_is_cleaned_up(self):
        service = fragment_service.FragmentService()

        async def chunks():
            yield b"abc"
            yield b"def"

        async def failed_chunks():
            yield b"partial"
            raise RuntimeError("stream failed")

        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            with patch.object(model_cache, "CACHE_DIR", cache_dir):
                self.assertEqual(await service.store_stream("abc", chunks()), 6)
                self.assertEqual(service.cached_file("abc").read_bytes(), b"abcdef")
                with self.assertRaisesRegex(RuntimeError, "stream failed"):
                    await service.store_stream("failed", failed_chunks())
                self.assertFalse(any(cache_dir.glob("failed.frag.*.partial")))


if __name__ == "__main__":
    unittest.main()
