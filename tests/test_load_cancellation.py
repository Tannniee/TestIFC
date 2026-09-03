from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import model_cache
import model_runtime
import model_operations


class LoadCancellationTests(TestCase):
    def test_store_only_upload_never_replaces_the_active_model(self):
        state = model_runtime._ActiveModelState()
        previous = model_runtime.ActiveModel("old.ifc", "old", "old.ifc", 3, "before")
        state.set(previous)
        with (
            TemporaryDirectory() as temporary,
            patch.object(model_cache, "CACHE_DIR", Path(temporary)),
            patch.object(model_runtime, "_state", state),
            patch.object(model_runtime, "_activate_in_background") as activate,
        ):
            result = model_operations.materialize_uploaded_model(BytesIO(b"new IFC"), "new.ifc", store_only=True)
            self.assertIs(state.get(), previous)
            self.assertTrue(model_cache.cached_model_file(result.model_hash).exists())
            self.assertNotIn(result.model_hash, model_cache.pinned_model_hashes())
            activate.assert_not_called()

    def test_cancel_targets_exact_activation_even_for_same_hash(self):
        state = model_runtime._ActiveModelState()
        current = model_runtime.ActiveModel("a.ifc", "a", "a.ifc", 1, "new-activation")
        state.set(current)
        jobs = Mock()
        with patch.object(model_runtime, "_state", state), patch.object(model_runtime, "_background_indexes", jobs):
            self.assertFalse(model_runtime.cancel_active_load("a", "old-activation"))
            self.assertFalse(model_runtime.cancel_active_load("b", "new-activation"))
            self.assertIs(state.get(), current)
            jobs.cancel.assert_not_called()
            self.assertTrue(model_runtime.cancel_active_load("a", "new-activation"))
            jobs.cancel.assert_called_once()
            self.assertIsNone(state.get_or_none())
            self.assertFalse(model_runtime.cancel_active_load("a", "new-activation"))
