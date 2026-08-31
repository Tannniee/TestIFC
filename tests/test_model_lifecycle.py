from __future__ import annotations

import sys
import unittest
import os
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import model_cache
import model_runtime


def active_model(model_hash="a" * 64):
    return model_runtime.ActiveModel("sample.ifc", model_hash, "sample.ifc", 100, "now")


class ModelLifecycleTests(unittest.TestCase):
    def test_prepare_state_tracks_each_hash_and_its_error(self):
        state = model_runtime._PrepareState()
        self.assertTrue(state.begin("a"))
        self.assertFalse(state.begin("a"))
        state.end("a", "failed")
        self.assertFalse(state.is_preparing("a"))
        self.assertEqual(state.error_for("a"), "failed")
        state.clear_error("a")
        self.assertIsNone(state.error_for("a"))

    def test_active_state_reuses_and_releases_the_open_model(self):
        state = model_runtime._ActiveModelState()
        opened = object()
        state.set(active_model())
        with (
            patch.object(model_runtime, "model_source_path", return_value="cached.ifc"),
            patch.object(model_runtime.ifcopenshell, "open", return_value=opened) as open_ifc,
        ):
            self.assertIs(state.get_open_file(), opened)
            self.assertIs(state.get_open_file(), opened)
        open_ifc.assert_called_once_with("cached.ifc")
        self.assertTrue(state.release_model(0.0))
        self.assertFalse(state.is_open())

    def test_switching_hash_discards_the_previous_open_file(self):
        state = model_runtime._ActiveModelState()
        state.set(active_model("a" * 64), object())
        state.set(active_model("b" * 64))
        self.assertFalse(state.is_open())

    def test_fragment_commit_is_atomic_and_rejects_empty_bodies(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            with patch.object(model_cache, "CACHE_DIR", cache_dir):
                staging = model_cache.store_cached_fragments_start("abc")
                staging.write_bytes(b"fragment")
                self.assertEqual(model_cache.store_cached_fragments_commit("abc", staging), 8)
                self.assertEqual(model_cache.cached_fragments_file("abc").read_bytes(), b"fragment")

                empty = model_cache.store_cached_fragments_start("empty")
                empty.write_bytes(b"")
                with self.assertRaisesRegex(ValueError, "empty fragments body"):
                    model_cache.store_cached_fragments_commit("empty", empty)
                self.assertFalse(empty.exists())

    def test_fragment_staging_is_unique_and_replaces_the_target_atomically(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            with patch.object(model_cache, "CACHE_DIR", cache_dir):
                first = model_cache.store_cached_fragments_start("abc")
                second = model_cache.store_cached_fragments_start("abc")
                self.assertNotEqual(first, second)
                first.write_bytes(b"first")
                second.write_bytes(b"second")
                model_cache.store_cached_fragments_commit("abc", first)
                model_cache.store_cached_fragments_commit("abc", second)
                self.assertEqual(model_cache.cached_fragments_file("abc").read_bytes(), b"second")

    def test_retention_preserves_live_partial_uploads_and_removes_stale_ones(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            with patch.object(model_cache, "CACHE_DIR", cache_dir):
                recent = model_cache.store_cached_fragments_start("recent")
                recent.write_bytes(b"uploading")
                stale = model_cache.store_cached_fragments_start("stale")
                stale.write_bytes(b"abandoned")
                old = model_cache.time() - model_cache._PARTIAL_MAX_AGE_SECONDS - 1
                os.utime(stale, (old, old))
                model_cache.enforce_cache_retention("active")
                self.assertTrue(recent.exists())
                self.assertFalse(stale.exists())

    def test_model_stream_is_hashed_and_installed_atomically(self):
        content = b"ISO-10303-21;END-ISO-10303-21;"
        expected_hash = sha256(content).hexdigest()
        with TemporaryDirectory() as temporary:
            with patch.object(model_cache, "CACHE_DIR", Path(temporary)):
                cached = model_cache.store_model_stream(BytesIO(content))
                self.assertEqual(cached.content_hash, expected_hash)
                self.assertEqual(cached.size_bytes, len(content))
                self.assertEqual(cached.path.read_bytes(), content)
                self.assertFalse(any(Path(temporary).glob("*.partial")))

                cached.path.write_bytes(b"X" * len(content))
                repaired = model_cache.store_model_stream(BytesIO(content))
                self.assertEqual(repaired.path.read_bytes(), content)

    def test_register_model_preserves_the_hash_mismatch_error_contract(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary) / "cache"
            source = Path(temporary) / "sample.ifc"
            source.write_bytes(b"sample")
            with patch.object(model_cache, "CACHE_DIR", cache_dir):
                with self.assertRaisesRegex(model_runtime.HashMismatchError, "hash mismatch"):
                    model_runtime.register_model(str(source), "0" * 64)


if __name__ == "__main__":
    unittest.main()
