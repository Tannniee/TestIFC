from __future__ import annotations

import os
import sqlite3
import sys
import unittest
from contextlib import closing
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import index_builder
import model_cache
import model_index
import model_runtime
from background_tasks import LatestTaskRunner
from test_model_index import IfcFile, children, cold_record, record


class SmoothnessLifecycleTests(unittest.TestCase):
    def test_uploaded_bundle_is_pinned_until_activation_and_released_on_failure(self):
        with TemporaryDirectory() as temporary:
            observed_pins = []

            def fail(model):
                observed_pins.append(model.contentHashSha256 in model_cache.pinned_model_hashes())
                raise RuntimeError("activation failed")

            with (
                patch.object(model_cache, "CACHE_DIR", Path(temporary)),
                patch.object(model_cache, "_pins", {}),
                patch.object(model_runtime, "_activate_in_background", side_effect=fail),
            ):
                with self.assertRaisesRegex(RuntimeError, "activation failed"):
                    model_runtime.materialize_model_stream(BytesIO(b"IFC"), "test.ifc", True)
                self.assertEqual(observed_pins, [True])
                self.assertFalse(model_cache.pinned_model_hashes())

    def test_latest_pending_model_wins_and_running_job_is_cancelled(self):
        runner = LatestTaskRunner("test-index")
        started, release, cancelled = Event(), Event(), Event()
        calls = []

        def first(stop):
            calls.append("A")
            started.set()
            self.assertTrue(stop.wait(2))
            cancelled.set()
            self.assertTrue(release.wait(2))

        runner.submit("A", first)
        self.assertTrue(started.wait(2))
        runner.submit("B", lambda stop: calls.append("B"))
        self.assertTrue(cancelled.wait(2))
        runner.submit("C", lambda stop: calls.append("C"))
        release.set()
        self.assertTrue(runner.wait_idle(2))
        self.assertEqual(calls, ["A", "C"])

    def test_duplicate_active_job_is_not_restarted(self):
        runner = LatestTaskRunner("test-index")
        started, release = Event(), Event()
        stops = []

        def work(stop):
            started.set()
            release.wait(2)
            stops.append(stop.is_set())

        runner.submit("A", work)
        self.assertTrue(started.wait(2))
        runner.submit("A", lambda stop: stops.append("duplicate"))
        release.set()
        self.assertTrue(runner.wait_idle(2))
        self.assertEqual(stops, [False])

    def test_cancellation_while_waiting_for_another_process_lock(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "index.sqlite"
            lock = Path(temporary) / "index.lock"
            lock.write_text("other process", encoding="utf-8")
            stop = Event()
            with patch.object(index_builder, "sleep", side_effect=lambda _: stop.set()):
                with self.assertRaises(index_builder.BuildCancelled):
                    index_builder._claim_build_lock(target, lock, stop.is_set)
            self.assertEqual(lock.read_text(), "other process")

    def test_hot_publication_does_not_release_the_process_before_cold_finishes(self):
        with TemporaryDirectory() as temporary:
            process = Mock()
            process.is_alive.side_effect = [True, True, False, False]
            process.exitcode = 0
            context = Mock()
            context.Process.return_value = process
            hot = Mock()
            with (
                patch.object(index_builder, "_claim_build_lock", return_value=True),
                patch.object(index_builder.multiprocessing, "get_context", return_value=context),
                patch.object(model_index, "is_usable", return_value=True),
                patch.object(model_index, "is_complete", return_value=True),
            ):
                index_builder.prepare_model("a.ifc", "a", temporary, on_hot_ready=hot)
            hot.assert_called_once()
            self.assertEqual(process.join.call_count, 3)
            process.terminate.assert_not_called()
            process.close.assert_called_once()

    def test_cancellation_reaps_only_the_owned_worker_and_releases_lock(self):
        with TemporaryDirectory() as temporary:
            stop = Event()
            process = Mock()
            process.start.side_effect = stop.set
            process.is_alive.return_value = True
            context = Mock()
            context.Process.return_value = process
            with patch.object(index_builder.multiprocessing, "get_context", return_value=context):
                with self.assertRaises(index_builder.BuildCancelled):
                    index_builder.prepare_model("a.ifc", "a", temporary, cancelled=stop.is_set)
            process.terminate.assert_called_once()
            process.join.assert_called_once()
            process.close.assert_called_once()
            self.assertFalse(index_builder.build_lock_path_for(Path(temporary), "a").exists())

    def test_partial_cold_index_is_resumed_without_rebuilding_hot_records(self):
        with TemporaryDirectory() as temporary:
            target = model_index.index_path_for(Path(temporary), "a")
            model_index.build_hot(IfcFile(), target, "a", record, children)
            import ifc_elements
            import ifc_units
            with (
                patch.object(index_builder, "_ensure_store", return_value=None),
                patch.object(model_runtime.ifcopenshell, "open", return_value=IfcFile()),
                patch.object(ifc_units, "project_units", return_value={}),
                patch.object(ifc_elements, "build_cold_record", side_effect=lambda entity, *_: cold_record(entity)),
                patch.object(model_index, "build_hot") as hot,
                patch.dict(os.environ),
            ):
                index_builder._worker("a.ifc", "a", temporary)
            hot.assert_not_called()
            self.assertTrue(model_index.is_complete(target))

    def test_extractor_change_invalidates_cache_even_when_schema_is_unchanged(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "index.sqlite"
            model_index.build(IfcFile(), target, "a", record, children, cold_record)
            self.assertTrue(model_index.is_complete(target))
            with patch.object(model_index, "EXTRACTOR_VERSION", model_index.EXTRACTOR_VERSION + 1):
                self.assertFalse(model_index.is_usable(target))
            with closing(sqlite3.connect(target)) as connection:
                connection.execute("DELETE FROM meta WHERE key = 'extractor_version'")
                connection.commit()
            self.assertFalse(model_index.is_usable(target))

    def test_activation_schedules_retention_without_running_scan_inline(self):
        jobs = Mock()
        model = model_runtime.ActiveModel("a.ifc", "a", "a.ifc", 10, "now")
        with (
            patch.object(model_runtime, "_state", model_runtime._ActiveModelState()),
            patch.object(model_runtime, "_background_indexes", jobs),
            patch.object(model_index, "is_complete", return_value=True),
            patch.object(model_cache, "schedule_cache_retention") as schedule,
            patch.object(model_cache, "enforce_cache_retention") as enforce,
        ):
            model_runtime._activate_in_background(model)
        schedule.assert_called_once_with("a")
        enforce.assert_not_called()
        jobs.cancel.assert_called_once()

    def test_retention_coalesces_to_the_latest_active_hash(self):
        jobs = LatestTaskRunner("test-retention")
        with TemporaryDirectory() as temporary:
            with (
                patch.object(model_cache, "CACHE_DIR", Path(temporary)),
                patch.object(model_cache, "_retention_jobs", jobs),
                patch.object(model_cache, "_active_retention_hash", None),
                patch.object(model_cache, "CACHE_RETENTION_DELAY_SECONDS", 0.05),
                patch.object(model_cache, "enforce_cache_retention") as enforce,
            ):
                model_cache.schedule_cache_retention("A")
                model_cache.schedule_cache_retention("B")
                model_cache.schedule_cache_retention("C")
                self.assertTrue(jobs.wait_idle(2))
                self.assertEqual([call.args[0] for call in enforce.call_args_list], ["C"])

    def test_retention_scan_does_not_block_new_pins_and_rechecks_before_delete(self):
        with TemporaryDirectory() as temporary:
            cache = Path(temporary)
            old = cache / "old.ifc"
            old.write_bytes(b"keep me")
            pinned = Event()

            def size(_):
                thread = Thread(target=lambda: (model_cache.pin_model("old"), pinned.set()))
                thread.start()
                self.assertTrue(pinned.wait(2), "disk scan held the pin lock")
                thread.join(2)
                return 100

            with (
                patch.object(model_cache, "CACHE_DIR", cache),
                patch.object(model_cache, "CACHE_MAX_BYTES", 1),
                patch.object(model_cache, "_pins", {}),
                patch.object(model_cache, "_active_retention_hash", None),
                patch.object(model_cache, "_path_size", side_effect=size),
            ):
                model_cache.enforce_cache_retention("active")
                self.assertTrue(old.exists())


if __name__ == "__main__":
    unittest.main()
