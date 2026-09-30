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

import gis_anchor
import model_cache
import model_operations
import model_runtime


class GisAnchorTests(unittest.TestCase):
    def test_anchor_is_atomic_model_scoped_and_survives_model_cache_files(self):
        model_hash = "a" * 64
        anchor = {"longitude": 105.8, "latitude": 21.0, "elevationMeters": 11.2,
                  "rotationDegrees": 30.0, "scale": 1.0, "groundOffsetMeters": 39.25}
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertEqual(gis_anchor.read_anchor(root, model_hash)["status"], "unavailable")
            saved = gis_anchor.save_anchor(root, model_hash, anchor)
            self.assertEqual(saved["anchor"], anchor)
            self.assertEqual(gis_anchor.read_anchor(root, model_hash)["source"], "manual")
            self.assertEqual(list((root / "gis_anchors").glob("*.partial")), [])
            with patch.object(model_cache, "CACHE_DIR", root):
                model_cache.clear_cache("all")
            self.assertEqual(gis_anchor.read_anchor(root, model_hash)["status"], "manual")
            self.assertEqual(gis_anchor.read_anchor(root, "b" * 64)["status"], "unavailable")
            self.assertEqual(gis_anchor.delete_anchor(root, model_hash)["status"], "unavailable")
            self.assertEqual(gis_anchor.read_anchor(root, model_hash)["status"], "unavailable")
            with self.assertRaisesRegex(ValueError, "invalid_model_hash"):
                gis_anchor.save_anchor(root, "../bad", anchor)

    def test_operations_reject_no_model_and_wrong_hash(self):
        model_hash = "a" * 64
        model = model_runtime.ActiveModel("probe.ifc", model_hash, "probe", 1, "current")
        with patch.object(model_runtime._state, "get_or_none", return_value=None):
            with self.assertRaises(model_runtime.NoActiveModelError):
                model_operations.manual_anchor(model_hash)
        with patch.object(model_runtime._state, "get_or_none", return_value=model):
            with self.assertRaises(model_operations.ActiveModelChangedError):
                model_operations.delete_manual_anchor("b" * 64)


if __name__ == "__main__":
    unittest.main()
