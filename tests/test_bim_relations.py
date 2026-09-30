from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import ifcopenshell
import ifcopenshell.guid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import ifc_elements
import ifc_units
import model_index


class BimRelationTests(unittest.TestCase):
    def test_spatial_path_keeps_available_levels_when_hierarchy_is_incomplete(self):
        model = ifcopenshell.open(str(ROOT / "test-fixtures" / "phase3-bim.ifc"))
        beam = model.by_type("IfcBeam")[0]
        relation = next(rel for rel in model.by_type("IfcRelAggregates")
                        if rel.RelatedObjects[0].is_a("IfcBuilding"))
        model.remove(relation)
        self.assertEqual(
            [item["ifcType"] for item in ifc_elements._spatial_path(beam)],
            ["IfcBuilding", "IfcBuildingStorey"],
        )

    def test_spatial_path_and_multiple_group_memberships_survive_indexing(self):
        model = ifcopenshell.open(str(ROOT / "test-fixtures" / "phase3-bim.ifc"))
        beam = model.by_type("IfcBeam")[0]
        for name, kind in (("Envelope", "IfcGroup"),
                           ("Structure", "IfcGroup"),
                           ("Fire Alarm", "IfcSystem"),
                           ("Power", "IfcDistributionSystem")):
            group = model.create_entity(kind, GlobalId=ifcopenshell.guid.new(), Name=name)
            model.create_entity(
                "IfcRelAssignsToGroup", GlobalId=ifcopenshell.guid.new(),
                RelatedObjects=[beam], RelatingGroup=group,
            )

        units = ifc_units.project_units(model)
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "semantic.sqlite"
            model_index.build(
                model, target, "relations-hash",
                ifc_elements.build_hot_record,
                lambda entity: [child.id() for child in ifc_elements.direct_children(entity)],
                lambda entity: ifc_elements.build_cold_record(entity, model, units),
            )
            record = model_index.ModelIndex(target).record_by_express_id(beam.id())
            self.assertEqual(
                [item["ifcType"] for item in record["spatialPath"]],
                ["IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey"],
            )
            self.assertEqual([item["name"] for item in record["groups"]],
                             ["Envelope", "Structure"])
            self.assertEqual([item["name"] for item in record["systems"]],
                             ["Fire Alarm", "Power"])
            self.assertEqual(record["systems"][1]["ifcType"], "IfcDistributionSystem")
            storey = model.by_type("IfcBuildingStorey")[0]
            storey_record = model_index.ModelIndex(target).record_by_express_id(storey.id())
            self.assertEqual(
                [item["ifcType"] for item in storey_record["spatialPath"]],
                ["IfcProject", "IfcSite", "IfcBuilding"],
            )


if __name__ == "__main__":
    unittest.main()
