from __future__ import annotations

import hashlib
import io
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import content_hash
import material_reference
import model_query
from version import APP_VERSION


class FakeIndex:
    def __init__(self) -> None:
        self.summaries = {
            1: {"globalId": "A", "expressId": 1, "ifcType": "IfcProject", "name": "Root", "objectType": None},
            2: {"globalId": "B", "expressId": 2, "ifcType": "IfcWall", "name": "Wall", "objectType": "Basic"},
            3: {"globalId": "C", "expressId": 3, "ifcType": "IfcDoor", "name": "Door", "objectType": None},
        }

    def roots(self):
        return [1]

    def summary(self, express_id):
        return self.summaries.get(express_id)

    def children(self, express_id):
        links = {1: [self.summaries[2]], 2: [self.summaries[3]], 3: [self.summaries[1]]}
        return links.get(express_id, [])

    def search(self, query, ifc_type, limit):
        token = query.lower()
        values = [value for value in self.summaries.values() if token in (value["name"] or "").lower()]
        if ifc_type:
            values = [value for value in values if value["ifcType"] == ifc_type]
        return values[:limit], len(values) > limit


class CoreContractTests(unittest.TestCase):
    def test_version_contract(self):
        self.assertEqual(APP_VERSION, "1.0.3")

    def test_content_hash_contract(self):
        sample = bytes(range(256)) * 4
        expected = hashlib.sha256(sample).hexdigest()
        self.assertEqual(content_hash.sha256_hex(sample), expected)

        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "copy.bin"
            digest, size = content_hash.copy_and_hash(io.BytesIO(sample), target)
            self.assertEqual((digest, size), (expected, len(sample)))
            self.assertEqual(target.read_bytes(), sample)
            self.assertEqual(content_hash.sha256_file(target), expected)

    def test_mapping_digest_is_stable_across_key_order(self):
        left = {"steel": 7850.0, "concrete": 2400.0}
        right = {"concrete": 2400, "steel": 7850}
        self.assertEqual(content_hash.mapping_digest(left), content_hash.mapping_digest(right))

    def test_material_reference_contract(self):
        references = material_reference.load_material_reference()
        self.assertEqual(len(references), 1)
        reference = references[0]
        self.assertEqual(reference["revision"], "handbook-materials-2026-07")
        self.assertGreater(len(reference["materials"]), 5)
        steel = next(item for item in reference["materials"] if item["material"] == "Carbon steel")
        self.assertEqual(steel["kgPerM3"], 7850.0)

    def test_model_query_contract(self):
        index = FakeIndex()
        with patch.object(model_query, "active_index", return_value=index):
            tree = model_query.get_model_tree()
            result = model_query.search_model("  WALL ", "IfcWall", 999)

        self.assertTrue(tree["ok"])
        self.assertEqual(tree["rootCount"], 1)
        self.assertEqual(tree["roots"][0]["children"][0]["name"], "Wall")
        self.assertTrue(tree["roots"][0]["children"][0]["children"][0]["children"][0]["truncated"])
        self.assertEqual(result["limit"], model_query.MAX_SEARCH_LIMIT)
        self.assertEqual(result["returnedCount"], 1)
        self.assertEqual(result["results"][0]["globalId"], "B")


if __name__ == "__main__":
    unittest.main()
