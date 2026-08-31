from __future__ import annotations

import sys
import unittest
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

        def run(subjects, table, tolerance, on_progress=None):
            calls.append((list(subjects), table.revision, tolerance, on_progress))
            return {"subjects": list(subjects)}

        service = TakeoffService(lambda: ["MODEL-A", "MODEL-B"], run)
        table = DensityTable("steel", {})
        self.assertEqual(
            service.run("selection", ["SELECTED"], table, 0.05)["subjects"],
            ["SELECTED"],
        )
        self.assertEqual(service.run_model(table, 0.10)["subjects"], ["MODEL-A", "MODEL-B"])
        self.assertEqual(calls[0][:3], (["SELECTED"], "steel", 0.05))
        self.assertEqual(calls[1][:3], (["MODEL-A", "MODEL-B"], "steel", 0.10))

    def test_model_takeoff_job_records_success_and_failure(self):
        result = {"ok": True, "subjects": []}
        successful = TakeoffService(lambda: [], lambda *args, **kwargs: result)
        job = ModelTakeoffJob(successful)
        job._run(DensityTable("steel", {}), 0.05)
        self.assertEqual(job.progress()["status"], "done")
        self.assertIs(job.result(), result)

        def fail(*args, **kwargs):
            raise RuntimeError("failed")

        failed = ModelTakeoffJob(TakeoffService(lambda: [], fail))
        failed._run(DensityTable("steel", {}), 0.05)
        self.assertEqual(failed.progress()["status"], "failed")
        self.assertIn("RuntimeError: failed", failed.progress()["error"])
        self.assertIsNone(failed.result())

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
