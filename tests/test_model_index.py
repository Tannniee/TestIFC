from __future__ import annotations

import sys
import sqlite3
from contextlib import closing
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
    schema = "IFC4"

    def __init__(self):
        self.project = Entity(1, "IfcProject", "P1", "Project")
        self.wall = Entity(2, "IfcWall", "W2", "Wall B", "Basic")
        self.door = Entity(3, "IfcDoor", "D3", "Door A")

    def by_type(self, type_name, include_subtypes=True):
        if type_name == "IfcProject":
            return [self.project]
        if type_name == "IfcProduct":
            return [self.project, self.wall, self.door]
        if type_name == "IfcTypeProduct":
            raise RuntimeError("schema has no type products")
        return []


def record(entity):
    result = {
        "globalId": entity.GlobalId,
        "expressId": entity.id(),
        "ifcType": entity.is_a(),
        "name": entity.Name,
    }
    if entity.id() == 2:
        result["type"] = {"expressId": 15, "name": "Wall Type A"}
        result["material"] = {"expressId": 16, "name": "Concrete"}
    return result


def children(entity):
    return {1: [2, 3], 2: [], 3: []}.get(entity.id(), [])


def cold_record(entity):
    result = {"properties": {"Phase4": {"ExpressId": entity.id()}}}
    if entity.id() == 2:
        result["properties"]["Pset_WallCommon"] = {"id": 50, "FireRating": "2h", "IsExternal": False}
        result["quantities"] = {"Qto_WallBaseQuantities": {"NetVolume": 12.5, "NetArea": 0}}
        result["units"] = {"volumeUnit": "m3", "areaUnit": "m2"}
        result["classifications"] = [
            {"identification": "STR-BEAM", "name": "Structural steel"}
        ]
        result["groups"] = [{"expressId": 30, "name": "Envelope"}]
        result["systems"] = [{"expressId": 31, "name": "Facade system"}]
    return result


class ModelIndexTests(unittest.TestCase):
    def test_path_and_usability_contract(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            self.assertEqual(
                model_index.index_path_for(base, "abc"),
                base / "abc.semantic-v5.sqlite",
            )
            self.assertEqual(model_index.legacy_index_path_for(base, "abc"), base / "abc.sqlite")
            self.assertFalse(model_index.is_usable(base / "missing.sqlite"))
            bad = base / "bad.sqlite"
            bad.write_text("not sqlite", encoding="utf-8")
            self.assertFalse(model_index.is_usable(bad))

    def test_build_and_query_contract(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            rows = model_index.build(
                IfcFile(), target, "hash-1", record, children, cold_record
            )
            self.assertEqual(rows, 3)
            self.assertTrue(model_index.is_usable(target))

            index = model_index.ModelIndex(target)
            self.assertEqual(index.roots(), [1])
            self.assertEqual(index.record_by_global_id("W2")["name"], "Wall B")
            self.assertEqual(
                index.record_by_global_id("W2")["properties"]["Phase4"]["ExpressId"],
                2,
            )
            self.assertEqual(index.record_by_express_id(3)["ifcType"], "IfcDoor")
            self.assertEqual([item["expressId"] for item in index.children(1)], [3, 2])
            self.assertEqual(index.cold_status, "ready")
            browser = index.browser("systems")
            self.assertEqual([item["localId"] for item in browser["elements"]], [2, 3])
            self.assertEqual(browser["facets"], [{"key": "31", "label": "Facade system", "localId": 2}])
            self.assertEqual(index.browser("types")["facets"][0]["label"], "Wall Type A")
            self.assertEqual(index.browser("material")["facets"][0]["label"], "Concrete")
            self.assertEqual(index.browser("groups")["facets"][0]["label"], "Envelope")
            self.assertEqual(index.browser("classification")["facets"][0]["label"], "Structural steel")
            rating = index.semantic_search("pset", "Pset_WallCommon", "FireRating", "eq", "2h", "", 10)
            self.assertEqual([item["localId"] for item in rating["results"]], [2])
            self.assertEqual(index.semantic_search("pset", "Pset_WallCommon", "IsExternal", "eq", "false", "", 10)["results"][0]["value"], "false")
            volume = index.semantic_search("qto", "Qto_WallBaseQuantities", "NetVolume", "gte", "12.5", "IfcWall", 10)
            self.assertEqual(volume["results"][0]["unit"], "m3")
            self.assertEqual(index.semantic_search("qto", "Qto_WallBaseQuantities", "NetArea", "lt", "1", "", 10)["results"][0]["value"], "0")
            self.assertEqual(index.semantic_search("qto", "Qto_WallBaseQuantities", "NetArea", "eq", "0.0", "", 10)["results"][0]["localId"], 2)
            self.assertEqual(index.semantic_search("qto", "Qto_WallBaseQuantities", "NetVolume", "gt", "12.5", "", 10)["results"], [])
            self.assertEqual(index.semantic_search("pset", "Pset_WallCommon", "Missing", "eq", "2h", "", 10)["results"], [])
            self.assertEqual(index.semantic_search("pset", "Pset_WallCommon", "FireRating", "contains", "h", "", 10)["results"][0]["localId"], 2)
            with self.assertRaisesRegex(ValueError, "numeric_value_required"):
                index.semantic_search("qto", "Qto_WallBaseQuantities", "NetVolume", "gte", "many", "", 10)

    def test_compound_filters_combine_conditions_and_page_all_products(self):
        import sqlite3
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            model_index.build(IfcFile(), target, "compound", record, children, cold_record)
            index = model_index.ModelIndex(target)
            rating = {"kind": "pset", "setName": "Pset_WallCommon", "propertyName": "FireRating", "op": "eq", "value": "2h"}
            volume = {"kind": "qto", "setName": "Qto_WallBaseQuantities", "propertyName": "NetVolume", "op": "gt", "value": "20"}
            self.assertEqual(index.semantic_filter([rating, volume], "all", "", 0, 500)["total"], 0)
            self.assertEqual(index.semantic_filter([rating, volume], "any", "", 0, 500)["total"], 1)
            zero = {"kind": "qto", "setName": "Qto_WallBaseQuantities", "propertyName": "NetArea", "op": "eq", "value": "0.0"}
            self.assertEqual(index.semantic_filter([rating, zero], "all", "", 0, 500)["results"][0]["localId"], 2)
            self.assertEqual(index.semantic_filter([rating], "all", "IfcDoor", 0, 500)["total"], 0)
            self.assertEqual(index.semantic_filter([{**rating, "op": "contains", "value": "%"}], "all", "", 0, 500)["total"], 0)
            self.assertEqual(index.semantic_filter([{**rating, "value": "x' OR 1=1 --"}], "all", "", 0, 500)["total"], 0)
            catalog = index.semantic_fields()
            self.assertTrue(any(item["propertyName"] == "NetVolume" and item["unit"] == "m3" for item in catalog["fields"]))
            with sqlite3.connect(target) as connection:
                connection.executemany("INSERT INTO element(express_id,ifc_type,browser_element,record_json) VALUES (?,'IfcWall',1,'{}')", [(i,) for i in range(100, 1200)])
                connection.executemany("INSERT INTO semantic_value(kind,set_name,property_name,express_id,value_text) VALUES ('pset','Pset_WallCommon','FireRating',?,'2h')", [(i,) for i in range(100, 1200)])
            connection.close()
            cursor, ids = 0, []
            while True:
                page = index.semantic_filter([rating, rating], "any", "", cursor, 500)
                self.assertEqual(page["total"], 1101)
                ids.extend(item["localId"] for item in page["results"])
                if page["nextCursor"] is None:
                    break
                self.assertGreater(page["nextCursor"], cursor)
                cursor = page["nextCursor"]
            self.assertEqual(len(ids), 1101)
            self.assertEqual(len(set(ids)), 1101)
            with self.assertRaisesRegex(ValueError, "numeric_value_required"):
                index.semantic_filter([{**volume, "value": "nan"}], "all", "", 0, 500)
            with self.assertRaises(ValueError):
                index.semantic_filter([], "all", "", 0, 500)

    def test_hot_index_is_usable_before_cold_records_finish(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            rows = model_index.build_hot(IfcFile(), target, "hash-hot", record, children)

            self.assertEqual(rows, 3)
            self.assertTrue(model_index.is_usable(target))
            self.assertEqual(model_index.cold_status(target), "indexing")
            self.assertEqual(model_index.ModelIndex(target).browser("groups")["facets"], [])
            self.assertEqual(model_index.ModelIndex(target).semantic_search("pset", "Pset_WallCommon", "FireRating", "eq", "2h", "", 10)["coldStatus"], "indexing")
            self.assertNotIn(
                "properties", model_index.ModelIndex(target).record_by_global_id("W2")
            )

            model_index.build_cold(IfcFile(), target, cold_record)
            self.assertEqual(model_index.cold_status(target), "ready")

    def test_cold_failure_preserves_hot_index_and_records_error(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            model_index.build_hot(IfcFile(), target, "hash-error", record, children)

            def fail(_entity):
                raise RuntimeError("cold boom")

            with self.assertRaisesRegex(RuntimeError, "cold boom"):
                model_index.build_cold(IfcFile(), target, fail)

            self.assertTrue(model_index.is_usable(target))
            self.assertEqual(model_index.cold_status(target), "error")
            self.assertEqual(model_index.cold_error(target), "cold boom")

    def test_search_and_truncation_contract(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            model_index.build(
                IfcFile(), target, "hash-2", record, children, cold_record
            )
            index = model_index.ModelIndex(target)

            walls, truncated = index.search("wall", "IfcWall", 10)
            self.assertFalse(truncated)
            self.assertEqual([item["globalId"] for item in walls], ["W2"])

            results, truncated = index.search("", "", 2)
            self.assertTrue(truncated)
            self.assertEqual(len(results), 2)

            classified, truncated = index.search("structural steel", "", 10)
            self.assertFalse(truncated)
            self.assertEqual([item["globalId"] for item in classified], ["W2"])

            exact, truncated = index.search("W2", "", 10)
            self.assertFalse(truncated)
            self.assertEqual([item["globalId"] for item in exact], ["W2"])
            partial_guid, _ = index.search("W2-extra", "", 10)
            self.assertEqual(partial_guid, [])

            with closing(sqlite3.connect(target)) as connection:
                plan = " ".join(
                    str(column)
                    for row in connection.execute(
                        "EXPLAIN QUERY PLAN SELECT express_id FROM element WHERE global_id = ?",
                        ("W2",),
                    )
                    for column in row
                )
            self.assertIn("element_global_id", plan)

            punctuation, truncated = index.search("***", "", 10)
            self.assertFalse(truncated)
            self.assertEqual(punctuation, [])

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
