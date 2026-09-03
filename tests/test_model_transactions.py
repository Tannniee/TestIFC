import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import model_cache as cache
import model_runtime as runtime
import model_transactions as tx
from fragment_service import FragmentService


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        for target, value in [("CACHE_DIR", Path(self.temp.name)), ("_pins", {}), ("_active_retention_hash", None)]:
            p = patch.object(cache, target, value); p.start(); self.addCleanup(p.stop)
        for obj, target, value in [(runtime, "_state", runtime._ActiveModelState()), (tx, "_stages", {})]:
            p = patch.object(obj, target, value); p.start(); self.addCleanup(p.stop)
        for target in ["_queue_index_build"]:
            p = patch.object(runtime, target); p.start(); self.addCleanup(p.stop)
        p = patch.object(cache, "schedule_cache_retention"); p.start(); self.addCleanup(p.stop)
        self.a = self.model(b"A")
        self.b = self.model(b"B")
        runtime._state.set(self.a)

    def model(self, data):
        key = hashlib.sha256(data).hexdigest()
        path = cache.CACHE_DIR / f"{key}.ifc"; path.write_bytes(data)
        (cache.CACHE_DIR / f"{key}.fragments-v1-full.frag").write_bytes(data * 8)
        return runtime._active_model(cache.CachedModel(path, key, len(data)), path.name)

    def test_preparation_does_not_activate_and_pins_both_models(self):
        tx.prepare("b", self.b.contentHashSha256, "B.ifc")
        self.assertEqual(runtime._state.get(), self.a)
        self.assertEqual(cache.pinned_model_hashes(), {self.a.contentHashSha256, self.b.contentHashSha256})
        result = cache.clear_cache("all", self.a.contentHashSha256)
        self.assertEqual(result["removedFiles"], 0)
        tx.transition("b", "rollback")
        self.assertFalse(cache.pinned_model_hashes())

    def test_commit_retry_and_rollback_restore_exact_generation(self):
        tx.prepare("b", self.b.contentHashSha256, "B.ifc")
        first = tx.transition("b", "commit")
        self.assertEqual(first, tx.transition("b", "commit"))
        self.assertEqual(runtime._state.get().contentHashSha256, self.b.contentHashSha256)
        tx.transition("b", "rollback")
        tx.transition("b", "rollback")
        self.assertEqual(runtime._state.get(), self.a)
        self.assertFalse(cache.pinned_model_hashes())

    def test_same_hash_stale_ticket_cannot_replace_new_generation(self):
        tx.prepare("first", self.a.contentHashSha256, "A.ifc")
        tx.prepare("second", self.a.contentHashSha256, "A.ifc")
        tx.transition("second", "commit")
        with self.assertRaises(tx.TransactionConflict): tx.transition("first", "commit")
        tx.transition("first", "rollback")
        self.assertNotEqual(runtime._state.get().loadedAt, self.a.loadedAt)

    def test_late_rollback_cannot_erase_third_model(self):
        tx.prepare("b", self.b.contentHashSha256, "B.ifc")
        tx.transition("b", "commit")
        third = self.model(b"C"); runtime._state.set(third)
        with self.assertRaises(tx.TransactionConflict): tx.transition("b", "rollback")
        with self.assertRaises(tx.TransactionConflict): tx.transition("b", "commit")
        self.assertEqual(runtime._state.get(), third)

    def test_finalize_releases_previous_and_expiry_never_reverts_committed_model(self):
        tx.prepare("b", self.b.contentHashSha256, "B.ifc")
        tx.transition("b", "commit")
        tx.transition("b", "finalize")
        self.assertFalse(cache.pinned_model_hashes())
        with self.assertRaises(tx.TransactionConflict): tx.transition("b", "rollback")
        tx.reap_stages(shutdown=True)
        self.assertEqual(runtime._state.get().contentHashSha256, self.b.contentHashSha256)

    def test_cache_clear_fragments_only_and_full_cache_preserve_active_and_unknown_files(self):
        unrelated = cache.CACHE_DIR / "notes.txt"; unrelated.write_text("keep")
        result = cache.clear_cache("fragments", self.a.contentHashSha256)
        self.assertEqual(result["freedBytes"], 8)
        self.assertTrue(Path(self.b.path).exists())
        result = cache.clear_cache("all", self.a.contentHashSha256)
        self.assertEqual(result["freedBytes"], 1)
        self.assertTrue(Path(self.a.path).exists())
        self.assertTrue(unrelated.exists())

    def test_failed_validation_does_not_leak_pin(self):
        Path(self.b.path).write_bytes(b"corrupt")
        with self.assertRaises(ValueError): tx.prepare("b", self.b.contentHashSha256, "B.ifc")
        self.assertFalse(cache.pinned_model_hashes())

    def test_changed_staged_file_cannot_commit(self):
        tx.prepare("b", self.b.contentHashSha256, "B.ifc")
        Path(self.b.path).write_bytes(b"changed")
        with self.assertRaises(tx.TransactionConflict): tx.transition("b", "commit")
        self.assertEqual(runtime._state.get(), self.a)

    def test_commit_side_effect_failure_restores_active_state(self):
        tx.prepare("b", self.b.contentHashSha256, "B.ifc")
        with patch.object(runtime, "_queue_index_build", side_effect=RuntimeError("queue failed")):
            with self.assertRaises(RuntimeError): tx.transition("b", "commit")
        self.assertEqual(runtime._state.get(), self.a)
        tx.transition("b", "rollback")

    def test_removal_cannot_escape_cache_root(self):
        with tempfile.TemporaryDirectory() as outside:
            path = Path(outside) / ("c" * 64 + ".frag")
            path.write_bytes(b"keep")
            cache._remove_cache_path(path)
            self.assertTrue(path.exists())

    def test_fragment_download_lease_protects_bytes_and_releases_on_disconnect(self):
        with self.assertRaises(ConnectionError):
            with FragmentService().lease_download(self.b.contentHashSha256 + ".fragments-v1-full"):
                self.assertEqual(cache.clear_cache("fragments", self.a.contentHashSha256)["removedFiles"], 0)
                raise ConnectionError("disconnected")
        self.assertFalse(cache.pinned_model_hashes())
        self.assertEqual(cache.clear_cache("fragments", self.a.contentHashSha256)["removedFiles"], 1)


if __name__ == "__main__": unittest.main()
