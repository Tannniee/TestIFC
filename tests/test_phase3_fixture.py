from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import ifcopenshell


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
BENCHMARKS = ROOT / "benchmarks"
for path in (SRC, BENCHMARKS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import generate_phase3_fixture
import ifc_elements
import ifc_units
import mass
import mass_facts
import model_index


class Phase3FixtureTests(unittest.TestCase):
    def test_synthetic_ifc_exercises_semantics_and_phase5_analytic_mass(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "synthetic.ifc"
            generate_phase3_fixture.build(target)
            model = ifcopenshell.open(str(target))
            beam = model.by_type("IfcBeam")[0]

            semantic_path = Path(temporary) / "semantic.sqlite"
            semantic_units = ifc_units.project_units(model)
            model_index.build_hot(
                model,
                semantic_path,
                "synthetic-hash",
                ifc_elements.build_hot_record,
                lambda entity: [
                    child.id() for child in ifc_elements.direct_children(entity)
                ],
            )
            hot = model_index.ModelIndex(semantic_path).record_by_global_id(
                beam.GlobalId
            )
            self.assertEqual(hot["material"]["name"], "Steel")
            self.assertNotIn("properties", hot)
            model_index.build_cold(
                model,
                semantic_path,
                lambda entity: ifc_elements.build_cold_record(
                    entity, model, semantic_units
                ),
            )
            cold = model_index.ModelIndex(semantic_path).record_by_global_id(
                beam.GlobalId
            )
            self.assertIn("Pset_Phase3Benchmark", cold["properties"])
            self.assertEqual(model_index.cold_status(semantic_path), "ready")

            units = mass_facts.gather_project_units(model)
            facts = mass_facts.gather_part_facts(beam, units)
            iterator = mass_facts.gather_iterator_mesh_facts(model, (beam,), units)
            resolved = mass.authored_volume_candidate(
                facts, mass.DensityTable("steel", {"Steel": 7850.0})
            )

            self.assertEqual(facts.material_name, "Steel")
            self.assertAlmostEqual(facts.analytic.volume_m3, 0.008)
            self.assertEqual(facts.analytic.method, "ifc_extruded_area_solid")
            self.assertIsInstance(resolved, mass.Value)
            self.assertAlmostEqual(resolved.kg, 62.8)
            self.assertEqual(
                resolved.evidence.method, "density_x_authored_volume"
            )
            self.assertAlmostEqual(iterator[beam.id()].volume_m3, 0.008)
            self.assertEqual(iterator[beam.id()].method, "geometry_iterator")


if __name__ == "__main__":
    unittest.main()
