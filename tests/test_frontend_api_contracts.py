from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
CONTRACTS = ROOT / "frontend" / "src" / "lib" / "api-contracts.ts"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import app as app_module


def _typescript_interface(source: str, name: str) -> set[str]:
    match = re.search(
        rf"export interface {re.escape(name)}\s*\{{(?P<body>.*?)^\}}",
        source,
        flags=re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"missing TypeScript interface {name}")
    return set(re.findall(r"^\s{2}([A-Za-z][A-Za-z0-9]*)\??:", match.group("body"), re.MULTILINE))


class FrontendApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CONTRACTS.read_text(encoding="utf-8")
        cls.openapi = app_module.app.openapi()

    def test_frontend_endpoint_manifest_exists_in_openapi(self):
        endpoints = re.findall(
            r'\w+: \{ method: "(GET|POST|DELETE)", path: "([^"]+)" \}',
            self.source,
        )
        self.assertGreaterEqual(len(endpoints), 8)
        paths = self.openapi["paths"]
        for method, path in endpoints:
            self.assertIn(path, paths)
            self.assertIn(method.lower(), paths[path])

    def test_vite_proxy_prefixes_cover_every_public_api_route(self):
        array = re.search(
            r"export const API_PROXY_PREFIXES = \[(?P<body>.*?)\] as const;",
            self.source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(array)
        configured = set(re.findall(r'"(/[^"]+)"', array.group("body")))
        required = {
            "/" + path.lstrip("/").split("/", 1)[0]
            for path in self.openapi["paths"]
        }
        self.assertEqual(configured, required)

    def test_typescript_response_shapes_match_openapi_properties(self):
        schema_pairs = {
            "HealthResponse": "HealthResponse",
            "LoadModelResponse": "LoadModelResponse",
            "ActivateModelResponse": "ActivateModelResponse",
            "ModelRuntimeResponse": "ModelRuntimeResponse",
            "SelectionPayload": "SelectionPayload",
            "SelectionResponse": "SelectionResponse",
            "FragmentStoredResponse": "FragmentStoredResponse",
        }
        schemas = self.openapi["components"]["schemas"]
        for typescript_name, openapi_name in schema_pairs.items():
            with self.subTest(typescript_name=typescript_name):
                self.assertEqual(
                    _typescript_interface(self.source, typescript_name),
                    set(schemas[openapi_name]["properties"]),
                )


if __name__ == "__main__":
    unittest.main()
