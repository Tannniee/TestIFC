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

    def test_local_packaging_gates_without_github_actions(self):
        workflows = ROOT / ".github" / "workflows"
        self.assertFalse(list(workflows.glob("*.yml")) if workflows.exists() else [])
        self.assertFalse(list(workflows.glob("*.yaml")) if workflows.exists() else [])
        build = (ROOT / "BuildExe.cmd").read_text(encoding="utf-8")
        self.assertIn("-m unittest discover", build)
        self.assertIn("BuildFrontend.cmd", build)
        self.assertIn("dotnet publish", build)
        self.assertIn("-m PyInstaller", build)
        frontend_build = (ROOT / "frontend" / "BuildFrontend.cmd").read_text(encoding="utf-8")
        for command in ("run test", "run check", "run build"):
            self.assertIn(command, frontend_build)
        self.assertTrue((ROOT / "packaging" / "smoke_test_package.py").is_file())
        webview2_smoke = (
            ROOT / "frontend" / "e2e" / "webview2-smoke.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn("WEBVIEW2_USER_DATA_FOLDER", webview2_smoke)
        self.assertIn("--enable-unsafe-swiftshader", webview2_smoke)
        self.assertIn("reserveFreePort", webview2_smoke)


if __name__ == "__main__":
    unittest.main()
