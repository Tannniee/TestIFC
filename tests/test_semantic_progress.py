from __future__ import annotations

import sqlite3
import os
import subprocess
import sys
import threading
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from time import sleep
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import index_progress
import index_builder
import model_cache
import model_index
import model_runtime
from test_model_index import Entity, record, children


class DenseFile:
    def by_type(self, kind):
        if kind == "IfcProject":
            return [Entity(1, "IfcProject", "P1", "Project")]
        if kind == "IfcProduct":
            return [Entity(i, "IfcWall", f"W{i}", f"Wall {i}") for i in range(2, 501)]
        return []


class SemanticProgressTests(unittest.TestCase):
    def test_closed_windows_progress_pipe_does_not_turn_completed_index_into_failure(self):
        with TemporaryDirectory() as temporary:
            process = Mock()
            process.is_alive.return_value = False
            process.exitcode = 0
            receiver, sender = Mock(), Mock()
            receiver.poll.side_effect = [True, BrokenPipeError(109, "pipe ended")]
            receiver.recv.return_value = {"phase": "ready", "status": "ready"}
            context = Mock()
            context.Process.return_value = process
            context.Pipe.return_value = receiver, sender
            progress = Mock()
            with patch.object(index_builder, "_claim_build_lock", return_value=True), patch.object(index_builder.multiprocessing, "get_context", return_value=context), patch.object(model_index, "is_complete", return_value=True):
                index_builder.prepare_model("a.ifc", "a", temporary, on_progress=progress)
            progress.assert_called_once_with({"phase": "ready", "status": "ready"})
            process.close.assert_called_once()
            receiver.close.assert_called_once()

    def test_live_worker_lock_never_expires_by_age(self):
        with TemporaryDirectory() as temporary:
            lock = Path(temporary) / "model.lock"
            lock.write_text(f"pid={os.getpid()}\n", encoding="ascii")
            os.utime(lock, (1, 1))
            self.assertFalse(index_builder.build_lock_is_stale(lock))
            with patch.object(index_builder, "process_alive", return_value=False):
                self.assertTrue(index_builder.build_lock_is_stale(lock))

    def test_cross_process_writer_lease_is_released_after_owner_dies(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "probe.sqlite"
            marker = Path(temporary) / "second-writer"
            code = "from pathlib import Path; import sys; sys.path.insert(0,'src'); from index_writer import writer_lease\nwith writer_lease(Path(sys.argv[1])):\n print('owned',flush=True)\n input()"
            first = subprocess.Popen([sys.executable, "-c", code, str(target)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            second = None
            try:
                self.assertEqual(first.stdout.readline().strip(), "owned")
                other = "from pathlib import Path; import sys; sys.path.insert(0,'src'); from index_writer import writer_lease\nwith writer_lease(Path(sys.argv[1])):\n Path(sys.argv[2]).write_text('owned')"
                second = subprocess.Popen([sys.executable, "-c", other, str(target), str(marker)])
                sleep(.15)
                self.assertFalse(marker.exists())
                first.terminate(); first.wait(3)
                self.assertEqual(second.wait(5), 0)
                self.assertEqual(marker.read_text(), "owned")
            finally:
                for child in (first, second):
                    if child is not None and child.poll() is None:
                        child.terminate(); child.wait(3)
                first.stdin.close(); first.stdout.close()

    def test_reader_snapshot_does_not_block_cold_commits(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "probe.sqlite"
            model_index.build_hot(DenseFile(), target, "probe", record, children)
            with closing(sqlite3.connect(target)) as setup:
                setup.execute("PRAGMA journal_mode=WAL")
            with closing(sqlite3.connect(target.resolve().as_uri() + "?mode=ro", uri=True)) as reader:
                reader.execute("BEGIN")
                self.assertEqual(reader.execute("SELECT COUNT(*) FROM element_cold").fetchone()[0], 0)
                model_index.build_cold(DenseFile(), target, lambda _: {"properties": {"payload": "x" * 4096}})
                self.assertEqual(reader.execute("SELECT COUNT(*) FROM element_cold").fetchone()[0], 0)
                self.assertTrue(model_index.is_complete(target))
                self.assertTrue(Path(str(target) + "-wal").exists())
            model_index.recover_interrupted_build(target)
            self.assertTrue(model_index.is_complete(target))

    def test_crashed_cold_writer_retains_committed_batches_for_retry(self):
        with TemporaryDirectory() as temporary:
            target, marker = Path(temporary) / "probe.sqlite", Path(temporary) / "paused"
            model_index.build_hot(DenseFile(), target, "probe", record, children)
            code = """import sys, time
from pathlib import Path
sys.path[:0] = ['src', 'tests']
from test_semantic_progress import DenseFile
import model_index
def extract(entity):
    if entity.id() == 180:
        Path(sys.argv[2]).write_text('paused')
        time.sleep(30)
    return {'properties': {'ok': entity.id()}}
model_index.build_cold(DenseFile(), Path(sys.argv[1]), extract)
"""
            child = subprocess.Popen([sys.executable, "-c", code, str(target), str(marker)])
            try:
                deadline = monotonic() + 8
                while not marker.exists() and child.poll() is None and monotonic() < deadline:
                    sleep(.02)
                self.assertTrue(marker.exists())
                child.terminate(); child.wait(3)
            finally:
                if child.poll() is None:
                    child.terminate(); child.wait(3)
            model_index.recover_interrupted_build(target)
            with closing(sqlite3.connect(target)) as db:
                saved = db.execute("SELECT COUNT(*) FROM element_cold").fetchone()[0]
            self.assertGreaterEqual(saved, 128)
            progress = []
            model_index.build_cold(DenseFile(), target, lambda _: {}, on_progress=lambda *e: progress.append(e))
            self.assertEqual(progress[0][0], saved)
            self.assertTrue(model_index.is_complete(target))

    def test_retention_accounts_for_wal_and_retains_it_when_database_cannot_be_removed(self):
        with TemporaryDirectory() as temporary:
            cache = Path(temporary)
            active, old = "a" * 64, "b" * 64
            (cache / f"{active}.ifc").write_bytes(b"x")
            db = cache / f"{old}.semantic-v3.sqlite"
            wal = Path(str(db) + "-wal")
            db.write_bytes(b"x"); wal.write_bytes(b"x" * 4096)
            unlink = Path.unlink
            def fail_database(path, *args, **kwargs):
                if path == db:
                    raise PermissionError("reader holds database")
                return unlink(path, *args, **kwargs)
            with patch.object(model_cache, "CACHE_DIR", cache), patch.object(model_cache, "CACHE_KEEP_MODELS", 3), patch.object(model_cache, "CACHE_MAX_BYTES", 50):
                with patch.object(Path, "unlink", fail_database), self.assertLogs(model_cache.logger, "WARNING"):
                    model_cache.enforce_cache_retention(active)
                self.assertTrue(db.exists()); self.assertTrue(wal.exists())
                model_cache.enforce_cache_retention(active)
                self.assertFalse(db.exists()); self.assertFalse(wal.exists())

    def test_stall_uses_real_work_and_old_attempt_cannot_update_retry(self):
        with patch.object(index_progress, "monotonic", return_value=0) as clock:
            progress = index_progress.IndexProgress()
            attempt = progress.begin("a")
            progress.update(attempt, {"phase": "cold", "completed": 8, "total": 500})
            clock.return_value = 121
            progress.update(attempt, {"phase": "cold", "completed": 8, "total": 500})
            self.assertTrue(progress.snapshot("a")["stalled"])
            progress.update(attempt, {"completed": 9})
            self.assertFalse(progress.snapshot("a")["stalled"])
            retry = progress.begin("a")
            progress.update(attempt, {"status": "ready"})
            self.assertEqual(progress.snapshot("a")["attemptId"], retry)
            self.assertEqual(progress.snapshot("a")["status"], "running")
            progress.update(retry, {"phase": "opening"})
            clock.return_value = 300
            self.assertFalse(progress.snapshot("a")["stalled"])
            clock.return_value = 722
            self.assertTrue(progress.snapshot("a")["stalled"])

    def test_retry_checks_activation_attempt_and_retryable_status(self):
        state = model_runtime._ActiveModelState()
        model = model_runtime.ActiveModel("x.ifc", "a", "x.ifc", 1, "new")
        state.set(model)
        progress = index_progress.IndexProgress()
        attempt = progress.begin("a")
        runner = Mock()
        with patch.object(model_runtime, "_index_progress", progress), patch.object(model_runtime, "_background_indexes", runner), patch.object(model_runtime, "_queue_index_build") as queue:
            self.assertFalse(state.retry_index("a", "old", attempt))
            self.assertFalse(state.retry_index("a", "new", "old-attempt"))
            self.assertFalse(state.retry_index("a", "new", attempt))
            progress.update(attempt, {"status": "error", "error": "failed"})
            self.assertTrue(state.retry_index("a", "new", attempt))
            runner.cancel.assert_called_once()
            queue.assert_called_once_with(model)

    def test_same_hash_reactivation_preserves_running_progress(self):
        progress = index_progress.IndexProgress()
        attempt = progress.begin("a")
        progress.update(attempt, {"phase": "cold", "completed": 10})
        runner = Mock(contains=Mock(return_value=True))
        with patch.object(model_runtime, "_index_progress", progress), patch.object(model_runtime, "_background_indexes", runner):
            model_runtime._queue_index_build(model_runtime.ActiveModel("x.ifc", "a", "x.ifc", 1, "new"))
        self.assertEqual(progress.snapshot("a")["attemptId"], attempt)
        self.assertEqual(progress.snapshot("a")["completed"], 10)
        runner.submit.assert_not_called()

    def test_cold_reads_remain_available_while_extractor_is_paused(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "probe.sqlite"
            model_index.build_hot(DenseFile(), target, "probe", record, children)
            paused, release = threading.Event(), threading.Event()
            errors = []
            def extract(entity):
                if entity.id() == 110:
                    paused.set()
                    if not release.wait(4):
                        raise TimeoutError("reader did not finish")
                return {"properties": {"payload": "x" * 65536}, "classifications": [{"name": "tested"}]}
            def build():
                try:
                    model_index.build_cold(DenseFile(), target, extract)
                except BaseException as exc:
                    errors.append(exc)
            worker = threading.Thread(target=build)
            worker.start()
            try:
                self.assertTrue(paused.wait(4))
                started = monotonic()
                with closing(sqlite3.connect(target, timeout=0.25)) as reader:
                    self.assertEqual(reader.execute("PRAGMA journal_mode").fetchone()[0], "wal")
                    self.assertEqual(reader.execute("SELECT COUNT(*) FROM element").fetchone()[0], 500)
                    self.assertGreater(reader.execute("SELECT COUNT(*) FROM element_cold").fetchone()[0], 0)
                self.assertEqual(model_index.ModelIndex(target).record_by_global_id("P1")["name"], "Project")
                self.assertEqual(model_index.ModelIndex(target).roots(), [1])
                self.assertLess(monotonic() - started, 0.5)
            finally:
                release.set()
                worker.join(8)
            self.assertFalse(worker.is_alive())
            self.assertEqual(errors, [])
            self.assertTrue(model_index.is_complete(target))

    def test_retry_keeps_committed_records_and_resumes_incomplete_batch(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "probe.sqlite"
            model_index.build_hot(DenseFile(), target, "probe", record, children)
            def fail(entity):
                if entity.id() == 180:
                    raise RuntimeError("simulated extractor failure")
                return {"classifications": [{"name": "resumed"}]}
            with self.assertRaisesRegex(RuntimeError, "extractor failure"):
                model_index.build_cold(DenseFile(), target, fail)
            with closing(sqlite3.connect(target)) as reader:
                committed = {row[0] for row in reader.execute("SELECT express_id FROM element_cold")}
            self.assertGreaterEqual(len(committed), 128)
            self.assertLess(len(committed), 180)
            called, progress = [], []
            def extract(entity):
                called.append(entity.id())
                return {"classifications": [{"name": "resumed"}]}
            self.assertEqual(model_index.build_cold(DenseFile(), target, extract, on_progress=lambda *event: progress.append(event)), 500)
            self.assertEqual(progress[0][0], len(committed))
            self.assertFalse(committed.intersection(called))
            self.assertEqual(len(called) + len(committed), 500)
            with closing(sqlite3.connect(target)) as reader:
                self.assertEqual(reader.execute("SELECT COUNT(*) FROM element_fts WHERE element_fts MATCH 'resumed'").fetchone()[0], 500)
            self.assertTrue(model_index.is_complete(target))
            self.assertIsNone(model_index.cold_error(target))
