from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import takeoff


FIXTURES = Path(__file__).resolve().parent / "fixtures"


class Entity:
    def __init__(self, entity_id, global_id):
        self._id = entity_id
        self.GlobalId = global_id

    def id(self):
        return self._id


class IfcFile:
    def __init__(self, elements):
        self.elements = elements

    def by_type(self, type_name):
        return self.elements if type_name == "IfcElement" else []


class Session:
    def __init__(self, elements):
        self.ifc_file = IfcFile(elements)
        self._by_global_id = {element.GlobalId: element for element in elements}

    def locate_global_id(self, global_id):
        return self._by_global_id[global_id]


def result_wire():
    total = {
        "status": "value",
        "sumKg": 62.8,
        "nCounted": 1,
        "nMissing": 0,
        "nAmbiguous": 0,
        "nExcluded": 0,
        "nDisagreement": 0,
        "composition": {"density_x_section_volume": 1.0},
    }
    value = {"status": "value", "kg": 62.8}
    missing = {"status": "absent", "reason": "no_authored_weight"}
    missing_volume = {"status": "absent", "reason": "no_authored_volume"}
    missing_analytic = {"status": "absent", "reason": "no_analytic"}
    return {
        "schemaVersion": takeoff.TAKEOFF_SCHEMA_VERSION,
        "modelHash": "hash",
        "densityTableRevision": "steel",
        "densityTableDigest": "digest",
        "densityKgPerM3": {"Steel": 7850.0},
        "tolerance": 0.05,
        "subjects": [
            {
                "globalId": "A",
                "expressId": 1,
                "ifcType": "IfcBeam",
                "name": "B1",
                "section": "PL 10x200",
                "lengthM": 4.0,
                "authoredWeight": missing,
                "densityXAuthoredVolume": missing_volume,
                "densityXAnalyticVolume": missing_analytic,
                "densityXMeshVolume": value,
                "densityXSectionVolume": value,
                "resolved": value,
                "resolvedMethod": "density_x_mesh_volume",
                "disagreementPercent": 0.0,
                "excluded": False,
            }
        ],
        "totals": {
            "authoredWeight": {**total, "status": "absent", "sumKg": None, "nCounted": 0, "nMissing": 1},
            "densityXAuthoredVolume": {**total, "status": "absent", "sumKg": None, "nCounted": 0, "nMissing": 1},
            "densityXAnalyticVolume": {**total, "status": "absent", "sumKg": None, "nCounted": 0, "nMissing": 1},
            "densityXMeshVolume": total,
            "densityXSectionVolume": total,
            "resolved": total,
        },
        "comparisons": [],
    }


class TakeoffContractTests(unittest.TestCase):
    def test_model_subject_ids_deduplicate_members_of_one_assembly(self):
        part_a = Entity(1, "PART-A")
        part_b = Entity(2, "PART-B")
        assembly = Entity(10, "ASSEMBLY")
        with patch.object(takeoff.mass_facts, "takeoff_subject", return_value=assembly):
            self.assertEqual(
                takeoff.model_subject_ids(Session([part_a, part_b])),
                ["ASSEMBLY"],
            )

    def test_csv_keeps_schema_metadata_and_mass_status_columns(self):
        csv_text = takeoff.takeoff_csv(result_wire())
        self.assertIn("# takeoffSchemaVersion,6", csv_text)
        self.assertIn("authoredWeight_kg,authoredWeight_status", csv_text)
        self.assertIn("no_authored_weight", csv_text)
        self.assertIn("62.8,value", csv_text)

    def test_csv_matches_the_version_6_golden_contract(self):
        expected = (FIXTURES / "takeoff_v6_expected.csv").read_text(encoding="utf-8")
        self.assertEqual(takeoff.takeoff_csv(result_wire()), expected)

    def test_whole_assembly_selection_overrides_partial_part_selection(self):
        part = Entity(1, "PART")
        assembly = Entity(10, "ASSEMBLY")

        def subject(element):
            return assembly if element is part else element

        with (
            patch.object(takeoff.mass_facts, "takeoff_subject", side_effect=subject),
        ):
            subjects, selected, picked = takeoff._group_selection(
                Session([part, assembly]),
                ["PART", "ASSEMBLY"],
            )

        self.assertEqual(list(subjects), [10])
        self.assertIsNone(selected[10])
        self.assertEqual(picked, [part, assembly])

    def test_quickview_keeps_numeric_mass_cells_for_excel(self):
        rows, header_index = takeoff.quickview_rows(result_wire())
        self.assertEqual(rows[header_index][4], "M1 authored WEIGHT (kg)")
        self.assertEqual(rows[header_index + 1][4], "")
        self.assertEqual(rows[header_index + 1][5:10], ["", "", 62.8, 62.8, 62.8])


if __name__ == "__main__":
    unittest.main()
