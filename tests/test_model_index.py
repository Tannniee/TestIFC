from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import model_index


class Entity:
    def __init__(self, express_id, ifc_type, global_id, name, object_type=None):
        self._id = express_id
        self._type = ifc_type
        self.GlobalId = global_id
        self.Name = name
        self.ObjectType = object_type

    def id(self):
        return self._id

    def is_a(self):
        return self._type


class IfcFile:
    def __init__(self):
        self.project = Entity(1, "IfcProject", "P1", "Project")
        self.wall = Entity(2, "IfcWall", "W2", "Wall B", "Basic")
        self.door = Entity(3, "IfcDoor", "D3", "Door A")

    def by_type(self, type_name):
        if type_name == "IfcProject":
            return [self.project]
        if type_name == "IfcProduct":
            return [self.project, self.wall, self.door]
        if type_name == "IfcTypeProduct":
            raise RuntimeError("schema has no type products")
        return []


def record(entity):
    return {
        "globalId": entity.GlobalId,
        "expressId": entity.id(),
        "ifcType": entity.is_a(),
        "name": entity.Name,
    }


def children(entity):
    return {1: [2, 3], 2: [], 3: []}.get(entity.id(), [])


class ModelIndexTests(unittest.TestCase):
    def test_path_and_usability_contract(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            self.assertEqual(model_index.index_path_for(base, "abc"), base / "abc.sqlite")
            self.assertFalse(model_index.is_usable(base / "missing.sqlite"))
            bad = base / "bad.sqlite"
            bad.write_text("not sqlite", encoding="utf-8")
            self.assertFalse(model_index.is_usable(bad))

    def test_build_and_query_contract(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            rows = model_index.build(IfcFile(), target, "hash-1", record, children)
            self.assertEqual(rows, 3)
            self.assertTrue(model_index.is_usable(target))

            index = model_index.ModelIndex(target)
            self.assertEqual(index.roots(), [1])
            self.assertEqual(index.record_by_global_id("W2")["name"], "Wall B")
            self.assertEqual(index.record_by_express_id(3)["ifcType"], "IfcDoor")
            self.assertEqual([item["expressId"] for item in index.children(1)], [3, 2])

    def test_search_and_truncation_contract(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            model_index.build(IfcFile(), target, "hash-2", record, children)
            index = model_index.ModelIndex(target)

            walls, truncated = index.search("wall", "IfcWall", 10)
            self.assertFalse(truncated)
            self.assertEqual([item["globalId"] for item in walls], ["W2"])

            results, truncated = index.search("", "", 2)
            self.assertTrue(truncated)
            self.assertEqual(len(results), 2)

    def test_missing_records_raise_clear_errors(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            model_index.build(IfcFile(), target, "hash-3", record, children)
            index = model_index.ModelIndex(target)
            with self.assertRaisesRegex(LookupError, "GlobalId 'missing'"):
                index.record_by_global_id("missing")
            with self.assertRaisesRegex(LookupError, "express id 999"):
                index.record_by_express_id(999)


if __name__ == "__main__":
    unittest.main()
