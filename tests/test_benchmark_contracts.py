from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "benchmarks" / "run_backend_baseline.py"
SPEC = importlib.util.spec_from_file_location("run_backend_baseline", RUNNER)
assert SPEC is not None and SPEC.loader is not None
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class BenchmarkContractTests(unittest.TestCase):
    def test_example_manifest_matches_the_versioned_contract(self):
        manifest = benchmark.load_manifest(
            ROOT / "benchmarks" / "corpus.example.json"
        )
        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertTrue(manifest["models"])

    def test_manifest_rejects_duplicate_ids_and_invalid_hashes(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "corpus.json"
            path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "models": [
                            {"id": "same", "path": "a.ifc"},
                            {
                                "id": "same",
                                "path": "b.ifc",
                                "expectedSha256": "not-a-hash",
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "duplicate model id"):
                benchmark.load_manifest(path)

    def test_local_corpus_and_results_are_not_committed(self):
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("benchmarks/corpus.local.json", ignore)
        self.assertIn("benchmarks/results/", ignore)


if __name__ == "__main__":
    unittest.main()
