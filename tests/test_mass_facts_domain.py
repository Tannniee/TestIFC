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


class Entity:
    def __init__(self, entity_id, ifc_type, **values):
        self._id = entity_id
        self._type = ifc_type
        for name, value in values.items():
            setattr(self, name, value)

    def id(self):
        return self._id

    def is_a(self, kind=None):
        return self._type if kind is None else self._type == kind


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

    def test_extruded_rectangle_volume_is_analytic_and_unit_normalized(self):
        profile = Entity(20, "IfcRectangleProfileDef", XDim=200.0, YDim=10.0)
        solid = Entity(21, "IfcExtrudedAreaSolid", SweptArea=profile, Depth=4000.0)

        facts = mass_facts._analytic_from_item(solid, 0.001)

        self.assertAlmostEqual(facts.volume_m3, 0.008)
        self.assertAlmostEqual(facts.length_m, 4.0)
        self.assertEqual(facts.method, "ifc_extruded_area_solid")

    def test_swept_disk_polyline_volume_uses_curve_length(self):
        points = (
            Entity(31, "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
            Entity(32, "IfcCartesianPoint", Coordinates=(3000.0, 4000.0, 0.0)),
        )
        directrix = Entity(33, "IfcPolyline", Points=points)
        solid = Entity(
            34,
            "IfcSweptDiskSolid",
            Directrix=directrix,
            Radius=100.0,
            InnerRadius=80.0,
        )

        facts = mass_facts._analytic_from_item(solid, 0.001)

        self.assertAlmostEqual(facts.length_m, 5.0)
        self.assertAlmostEqual(facts.volume_m3, 3.141592653589793 * (0.1**2 - 0.08**2) * 5.0)


if __name__ == "__main__":
    unittest.main()
