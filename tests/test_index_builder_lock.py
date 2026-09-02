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

import index_builder


class IndexBuilderLockTests(unittest.TestCase):
    def test_claim_is_exclusive_and_reuses_a_finished_index(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            target = cache_dir / "model.sqlite"
            lock = cache_dir / "model.lock"
            with patch.object(index_builder.model_index, "is_complete", return_value=False):
                self.assertTrue(index_builder._claim_build_lock(target, lock))
                self.assertTrue(lock.exists())
            with patch.object(index_builder.model_index, "is_complete", return_value=True):
                self.assertFalse(index_builder._claim_build_lock(target, lock))

    def test_stale_lock_is_replaced(self):
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            target = cache_dir / "model.sqlite"
            lock = cache_dir / "model.lock"
            lock.write_text("old", encoding="ascii")
            old = index_builder.time() - index_builder._BUILD_LOCK_MAX_AGE_SECONDS - 1
            import os

            os.utime(lock, (old, old))
            with patch.object(index_builder.model_index, "is_complete", return_value=False):
                self.assertTrue(index_builder._claim_build_lock(target, lock))
            self.assertIn("pid=", lock.read_text(encoding="ascii"))


if __name__ == "__main__":
    unittest.main()
