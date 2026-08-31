from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import member_axis


def face(points, normal, area, centroid):
    return member_axis._Face(tuple(points), normal, area, centroid)


class MemberAxisDomainTests(unittest.TestCase):
    def test_polygon_centroid_uses_area_not_vertex_average(self):
        centroid = member_axis._area_centroid(
            ((0, 0, 0), (2, 0, 0), (2, 1, 0), (0, 1, 0)),
            member_axis.np.array((0.0, 0.0, 1.0)),
        )
        self.assertEqual(tuple(round(value, 6) for value in centroid), (1.0, 0.5, 0.0))

    def test_roll_angles_fold_to_the_half_turn_range(self):
        self.assertEqual(member_axis._fold_half_turn(100.0), -80.0)
        self.assertEqual(member_axis._fold_half_turn(-100.0), 80.0)
        self.assertEqual(member_axis._fold_half_turn(270.0), 90.0)

    def test_rectangular_prism_axis_runs_between_end_caps(self):
        faces = (
            face(((0, -1, -0.5), (0, 1, -0.5), (0, 1, 0.5), (0, -1, 0.5)), (-1, 0, 0), 2, (0, 0, 0)),
            face(((4, -1, -0.5), (4, -1, 0.5), (4, 1, 0.5), (4, 1, -0.5)), (1, 0, 0), 2, (4, 0, 0)),
            face(((0, -1, -0.5), (4, -1, -0.5), (4, -1, 0.5), (0, -1, 0.5)), (0, -1, 0), 4, (2, -1, 0)),
            face(((0, 1, -0.5), (0, 1, 0.5), (4, 1, 0.5), (4, 1, -0.5)), (0, 1, 0), 4, (2, 1, 0)),
            face(((0, -1, -0.5), (0, 1, -0.5), (4, 1, -0.5), (4, -1, -0.5)), (0, 0, -1), 8, (2, 0, -0.5)),
            face(((0, -1, 0.5), (4, -1, 0.5), (4, 1, 0.5), (0, 1, 0.5)), (0, 0, 1), 8, (2, 0, 0.5)),
        )
        result = member_axis.axis_of_faces(faces)
        self.assertIsInstance(result, member_axis.MemberAxis)
        self.assertAlmostEqual(result.length_m, 4.0)
        self.assertEqual(result.route, "brep_end_caps")
        self.assertAlmostEqual(abs(result.direction[0]), 1.0)

    def test_missing_faces_report_a_specific_absence(self):
        result = member_axis.axis_of_faces(())
        self.assertIsInstance(result, member_axis.AxisAbsent)
        self.assertEqual(result.reason, "no_faces")


if __name__ == "__main__":
    unittest.main()
