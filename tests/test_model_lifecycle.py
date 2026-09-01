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
    def tearDown(self):
        with model_cache._retention_lock:
            model_cache._pins.clear()

    def test_prepare_state_tracks_each_hash_and_its_error(self):
        state = model_runtime._PrepareState()
        self.assertTrue(state.begin("a"))
        self.assertFalse(state.begin("a"))
        state.end("a", "failed")
        self.assertFalse(state.is_preparing("a"))
        self.assertEqual(state.error_for("a"), "failed")
        state.clear_error("a")
        self.assertIsNone(state.error_for("a"))

    def test_runtime_reports_semantic_readiness_for_the_active_hash(self):
        model_hash = "a" * 64
        state = model_runtime._ActiveModelState()
        prepare = model_runtime._PrepareState()
        state.set(active_model(model_hash))
        with (
            patch.object(model_runtime, "_state", state),
            patch.object(model_runtime, "_prepare", prepare),
        ):
            ready = model_runtime.live_model_status()
            self.assertEqual(ready["activeModelHash"], model_hash)
            self.assertEqual(ready["hotIndexStatus"], "ready")
            self.assertEqual(ready["coldIndexStatus"], "not_configured")
            self.assertIsNone(ready["coldIndexError"])

            prepare.begin(model_hash)
            self.assertEqual(
                model_runtime.live_model_status()["hotIndexStatus"],
                "indexing",
            )
            prepare.end(model_hash, "index failed")
            failed = model_runtime.live_model_status()
            self.assertEqual(failed["hotIndexStatus"], "error")
            self.assertEqual(failed["prepareError"], "index failed")

    def test_index_failure_keeps_the_model_active_for_geometry(self):
        model = active_model()
        state = model_runtime._ActiveModelState()
        prepare = model_runtime._PrepareState()
        state.set(model)
        prepare.begin(model.contentHashSha256)
        with (
            patch.object(model_runtime, "_state", state),
            patch.object(model_runtime, "_prepare", prepare),
            patch.object(
                model_runtime.index_builder,
                "prepare_model",
                side_effect=RuntimeError("index failed"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "index failed"):
                model_runtime._run_build(model, Path("unused.sqlite"))
        self.assertEqual(state.get().contentHashSha256, model.contentHashSha256)

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

    def test_retention_never_evicts_a_pinned_model_bundle(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            pinned_hash = "a" * 64
            old_hash = "b" * 64
            active_hash = "c" * 64
            for model_hash in (pinned_hash, old_hash, active_hash):
                (cache_dir / f"{model_hash}.ifc").write_bytes(model_hash.encode())
                (cache_dir / f"{model_hash}.sqlite").write_bytes(b"index")
            with (
                patch.object(model_cache, "CACHE_DIR", cache_dir),
                patch.object(model_cache, "CACHE_KEEP_MODELS", 1),
            ):
                model_cache.pin_model(pinned_hash)
                model_cache.enforce_cache_retention(active_hash)
                self.assertTrue((cache_dir / f"{pinned_hash}.ifc").exists())
                self.assertTrue((cache_dir / f"{active_hash}.ifc").exists())
                self.assertFalse((cache_dir / f"{old_hash}.ifc").exists())
                model_cache.unpin_model(pinned_hash)

    def test_retention_groups_fragment_profiles_with_their_model(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            active_hash = "a" * 64
            old_hash = "b" * 64
            active_fragment = cache_dir / f"{active_hash}.fragments-v2-minimum.frag"
            old_fragment = cache_dir / f"{old_hash}.fragments-v2-full.frag"
            active_semantic = cache_dir / f"{active_hash}.semantic-v2.sqlite"
            old_facts = cache_dir / f"{old_hash}.facts-v1.sqlite"
            active_fragment.write_bytes(b"active")
            old_fragment.write_bytes(b"old")
            active_semantic.write_bytes(b"active semantic")
            old_facts.write_bytes(b"old facts")
            with (
                patch.object(model_cache, "CACHE_DIR", cache_dir),
                patch.object(model_cache, "CACHE_KEEP_MODELS", 1),
            ):
                model_cache.enforce_cache_retention(active_hash)
            self.assertTrue(active_fragment.exists())
            self.assertTrue(active_semantic.exists())
            self.assertFalse(old_fragment.exists())
            self.assertFalse(old_facts.exists())

    def test_retention_applies_the_byte_budget_to_complete_bundles(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            active_hash = "a" * 64
            recent_hash = "b" * 64
            old_hash = "c" * 64
            for ordinal, model_hash in enumerate((old_hash, recent_hash, active_hash)):
                path = cache_dir / f"{model_hash}.ifc"
                path.write_bytes(b"x" * 8)
                os.utime(path, (100 + ordinal, 100 + ordinal))
            with (
                patch.object(model_cache, "CACHE_DIR", cache_dir),
                patch.object(model_cache, "CACHE_KEEP_MODELS", 10),
                patch.object(model_cache, "CACHE_MAX_BYTES", 16),
            ):
                model_cache.enforce_cache_retention(active_hash)
            self.assertTrue((cache_dir / f"{active_hash}.ifc").exists())
            self.assertTrue((cache_dir / f"{recent_hash}.ifc").exists())
            self.assertFalse((cache_dir / f"{old_hash}.ifc").exists())

    def test_retention_protects_bundle_while_a_partial_artifact_is_live(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            building_hash = "b" * 64
            active_hash = "a" * 64
            old_hash = "c" * 64
            for model_hash in (building_hash, active_hash, old_hash):
                (cache_dir / f"{model_hash}.ifc").write_bytes(b"model")
            partial = cache_dir / f"{building_hash}.semantic-v3.sqlite.partial"
            partial.write_bytes(b"building")
            with (
                patch.object(model_cache, "CACHE_DIR", cache_dir),
                patch.object(model_cache, "CACHE_KEEP_MODELS", 1),
                patch.object(model_cache, "CACHE_MAX_BYTES", 1),
            ):
                model_cache.enforce_cache_retention(active_hash)
            self.assertTrue((cache_dir / f"{active_hash}.ifc").exists())
            self.assertTrue((cache_dir / f"{building_hash}.ifc").exists())
            self.assertTrue(partial.exists())
            self.assertFalse((cache_dir / f"{old_hash}.ifc").exists())

    def test_retention_protects_bundle_while_semantic_build_lock_exists(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            building_hash = "b" * 64
            active_hash = "a" * 64
            (cache_dir / f"{building_hash}.ifc").write_bytes(b"building")
            (cache_dir / f"{active_hash}.ifc").write_bytes(b"active")
            (cache_dir / f"{building_hash}.semantic-v3.lock").write_text("pid=1")
            with (
                patch.object(model_cache, "CACHE_DIR", cache_dir),
                patch.object(model_cache, "CACHE_KEEP_MODELS", 1),
                patch.object(model_cache, "CACHE_MAX_BYTES", 1),
            ):
                model_cache.enforce_cache_retention(active_hash)
            self.assertTrue((cache_dir / f"{building_hash}.ifc").exists())

    def test_cache_limits_have_safe_minimums(self):
        self.assertEqual(model_cache.cache_keep_models("0"), 1)
        self.assertEqual(model_cache.cache_max_bytes("0"), 1)

    def test_session_keeps_one_hash_after_the_active_model_switches(self):
        hash_a = "a" * 64
        hash_b = "b" * 64
        state = model_runtime._ActiveModelState()
        state.set(active_model(hash_a))
        opened_paths = []

        class Element:
            GlobalId = "GUID-A"

        class IfcFile:
            def by_id(self, express_id):
                self.express_id = express_id
                return Element()

        class Index:
            def record_by_global_id(self, global_id):
                self.global_id = global_id
                return {"expressId": 7}

        def open_ifc(path):
            opened_paths.append(path)
            return IfcFile()

        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            with (
                patch.object(model_runtime, "_state", state),
                patch.object(model_runtime, "_prepare", model_runtime._PrepareState()),
                patch.object(model_cache, "CACHE_DIR", cache_dir),
                patch.object(model_runtime.model_index, "is_usable", return_value=True),
                patch.object(model_runtime.model_index, "ModelIndex", return_value=Index()),
                patch.object(model_runtime, "model_source_path", side_effect=lambda model: model.path),
                patch.object(model_runtime.ifcopenshell, "open", side_effect=open_ifc),
            ):
                lease = model_runtime.lease_active_model()
                state.set(active_model(hash_b))
                with lease.open_session() as session:
                    self.assertEqual(session.ref.model_hash, hash_a)
                    self.assertEqual(session.locate_global_id("GUID-A").GlobalId, "GUID-A")
                self.assertEqual(opened_paths, ["sample.ifc"])
                self.assertNotIn(hash_a, model_cache.pinned_model_hashes())

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

    def test_new_upload_waits_for_activation_before_retention(self):
        old_hash = "a" * 64
        content = b"ISO-10303-21;NEW;END-ISO-10303-21;"
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            old_path = cache_dir / f"{old_hash}.ifc"
            old_path.write_bytes(b"active model")
            with (
                patch.object(model_cache, "CACHE_DIR", cache_dir),
                patch.object(model_cache, "CACHE_KEEP_MODELS", 1),
            ):
                cached = model_cache.store_model_stream(BytesIO(content))
                self.assertTrue(old_path.exists())
                self.assertTrue(cached.path.exists())

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
