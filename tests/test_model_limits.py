from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import content_hash
import model_cache
import model_limits


class ModelLimitTests(unittest.TestCase):
    def test_limit_allows_exactly_one_gib_and_rejects_larger(self):
        model_limits.require_supported_ifc_size(model_limits.MAX_IFC_BYTES)
        with self.assertRaises(model_limits.ModelTooLargeError):
            model_limits.require_supported_ifc_size(model_limits.MAX_IFC_BYTES + 1)

    def test_stream_limit_stops_before_writing_the_rejected_chunk(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "copy.bin"
            with self.assertRaises(content_hash.ContentTooLargeError):
                content_hash.copy_and_hash(io.BytesIO(b"12345"), target, max_bytes=4)
            self.assertEqual(target.read_bytes(), b"")

    def test_model_cache_removes_partial_file_after_oversize_stream(self):
        with tempfile.TemporaryDirectory() as temporary, \
             patch.object(model_cache, "CACHE_DIR", Path(temporary)), \
             patch.object(model_cache, "MAX_IFC_BYTES", 4):
            with self.assertRaises(model_limits.ModelTooLargeError):
                model_cache.store_model_stream(io.BytesIO(b"12345"))
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_frontend_and_backend_limits_match(self):
        source = (ROOT / "frontend" / "src" / "lib" / "model-limits.ts").read_text(encoding="utf-8")
        self.assertIn("1024 * 1024 * 1024", source)
        self.assertEqual(model_limits.MAX_IFC_BYTES, 1024 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
