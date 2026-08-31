from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import mass_facts


class MappingTarget:
    def __init__(self, scale=1.0, scale2=None, scale3=None, non_uniform=False):
        self.Scale = scale
        self.Scale2 = scale2
        self.Scale3 = scale3
        self.non_uniform = non_uniform

    def is_a(self, kind):
        return self.non_uniform and kind == "IfcCartesianTransformationOperator3DnonUniform"


class MassFactsDomainTests(unittest.TestCase):
    def test_tetrahedron_volume_uses_signed_orientation(self):
        positive = mass_facts._tetrahedron_volume((1, 0, 0), (0, 1, 0), (0, 0, 1))
        negative = mass_facts._tetrahedron_volume((1, 0, 0), (0, 0, 1), (0, 1, 0))
        self.assertAlmostEqual(positive, 1.0 / 6.0)
        self.assertAlmostEqual(negative, -1.0 / 6.0)

    def test_mesh_combination_requires_complete_geometry(self):
        first = mass_facts.MeshFacts(1.25, 4.0, (1,))
        second = mass_facts.MeshFacts(0.75, 3.0, (2,))
        combined = mass_facts._combine_meshes((first, second))
        self.assertEqual(combined.volume_m3, 2.0)
        self.assertEqual(combined.length_m, 4.0)
        self.assertEqual(combined.source_entity_ids, (1, 2))

        incomplete = mass_facts._combine_meshes(
            (first, mass_facts.MeshFacts(None, None, (3,), ("IfcSweptDiskSolid",)))
        )
        self.assertIsNone(incomplete.volume_m3)
        self.assertEqual(incomplete.unsupported_item_types, ("IfcSweptDiskSolid",))

    def test_non_uniform_mapping_scales_preserve_each_axis(self):
        target = MappingTarget(2.0, 3.0, 4.0, non_uniform=True)
        self.assertEqual(mass_facts._mapping_scale_factors(target), (2.0, 3.0, 4.0))
        self.assertEqual(
            mass_facts._mapping_scale_factors(MappingTarget(2.0)),
            (2.0, 2.0, 2.0),
        )


if __name__ == "__main__":
    unittest.main()
