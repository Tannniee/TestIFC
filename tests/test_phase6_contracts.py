from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import model_cache
import model_index
from api_routes.model import FRAGMENT_CACHE_KEY_PATTERN, MODEL_HASH_PATTERN


class Phase6ContractTests(unittest.TestCase):
    def test_semantic_v3_uses_fts5_and_exact_global_id_index(self):
        self.assertEqual(model_index.INDEX_SCHEMA_VERSION, 3)
        self.assertIn("USING fts5", model_index._SCHEMA)
        self.assertIn("CREATE INDEX element_global_id", model_index._SCHEMA)

    def test_cache_has_count_and_byte_limits(self):
        self.assertGreaterEqual(model_cache.CACHE_KEEP_MODELS, 1)
        self.assertGreaterEqual(model_cache.CACHE_MAX_BYTES, 1)

    def test_fragment_profile_key_does_not_weaken_model_hash_validation(self):
        self.assertNotEqual(FRAGMENT_CACHE_KEY_PATTERN, MODEL_HASH_PATTERN)
        self.assertIn("fragments-v", FRAGMENT_CACHE_KEY_PATTERN)

    def test_ci_and_release_workflows_include_phase6_gates(self):
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        release = (ROOT / ".github" / "workflows" / "release.yml").read_text(
            encoding="utf-8"
        )
        for required in (
            "python -m unittest",
            "pnpm run test",
            "pnpm run check",
            "pnpm run build",
            "pnpm run test:e2e",
        ):
            self.assertIn(required, ci)
        self.assertIn("cmd /c BuildExe.cmd", release)
        self.assertIn("packaging/smoke_test_package.py", release)
        self.assertIn("test:webview2", release)
        self.assertIn("MicrosoftEdgeWebview2Setup.exe", release)
        webview2_smoke = (
            ROOT / "frontend" / "e2e" / "webview2-smoke.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn("WEBVIEW2_USER_DATA_FOLDER", webview2_smoke)
        self.assertIn("--headless=new", webview2_smoke)
        self.assertIn("reserveFreePort", webview2_smoke)


if __name__ == "__main__":
    unittest.main()
