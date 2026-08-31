from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import mass
from mass_facts import AssemblyFacts, AuthoredWeightFacts, MassMeasureFact, MeshFacts, PartFacts


def no_authored_weight() -> AuthoredWeightFacts:
    return AuthoredWeightFacts((), (), (), (), False)


def part(*, entity_id=10, section="PL 10x200", volume=0.008, length=4.0):
    return PartFacts(
        entity_id,
        f"PART-{entity_id}",
        "IfcBeam",
        section,
        "Steel",
        (entity_id + 100,),
        MeshFacts(volume, length, (entity_id + 200,)),
        0.001,
    )


class MassDomainTests(unittest.TestCase):
    def test_mass_policy_validates_tolerance_and_normalizes_exclusions(self):
        with self.assertRaisesRegex(ValueError, "between 0 and 1"):
            mass.MassPolicy(0.0)
        policy = mass.MassPolicy(0.05, frozenset({"dummy", "Layout_Point"}))
        self.assertTrue(policy.excludes("DUMMY"))
        self.assertTrue(policy.excludes("layout_point"))
        self.assertFalse(policy.excludes("FRAME"))

    def test_authored_weight_converts_grams_and_rejects_conflicts(self):
        first = MassMeasureFact(1250.0, 1, "IfcQuantityWeight", "weight", "project_mass_unit", 1.0)
        same = MassMeasureFact(1.25, 2, "IfcPropertySingleValue", "weight", "explicit_mass_unit", 1000.0)
        facts = AuthoredWeightFacts((first, same), (), (), (), True)
        candidate = mass.authored_weight_candidate(facts)
        self.assertIsInstance(candidate, mass.Value)
        self.assertAlmostEqual(candidate.kg, 1.25)

        conflict = AuthoredWeightFacts(
            (first, MassMeasureFact(2000.0, 3, "IfcQuantityWeight", "weight", "project_mass_unit", 1.0)),
            (),
            (),
            (),
            True,
        )
        self.assertIsInstance(mass.authored_weight_candidate(conflict), mass.Ambiguous)

    def test_section_candidates_cover_plate_h_section_and_pipe(self):
        table = mass.DensityTable("steel", {"Steel": 7850.0})
        plate = mass.section_candidate(part(section="PL 10x200"), table)
        h_section = mass.section_candidate(part(section="H-300x150x8x12"), table)
        pipe = mass.section_candidate(part(section="CHS 114.3x6.3"), table)

        self.assertAlmostEqual(plate.kg, 62.8)
        expected_h_area = 2 * 0.150 * 0.012 + (0.300 - 2 * 0.012) * 0.008
        self.assertAlmostEqual(h_section.kg, expected_h_area * 4.0 * 7850.0)
        expected_pipe_area = math.pi * (0.1143**2 - (0.1143 - 2 * 0.0063) ** 2) / 4
        self.assertAlmostEqual(pipe.kg, expected_pipe_area * 4.0 * 7850.0)

    def test_resolve_assembly_prefers_authored_weight_and_reports_disagreement(self):
        authored = AuthoredWeightFacts(
            (MassMeasureFact(80_000.0, 1, "IfcQuantityWeight", "weight", "project_mass_unit", 1.0),),
            (),
            (),
            (),
            True,
        )
        facts = AssemblyFacts("hash", "ASSEMBLY", 1, "FRAME", authored, (part(),), None)
        row = mass.resolve_assembly(facts, mass.DensityTable("steel", {"Steel": 7850.0}), 0.05)

        self.assertIsInstance(row.resolved, mass.Value)
        self.assertEqual(row.resolved.evidence.method, "authored_weight")
        self.assertTrue(row.disagreement)

    def test_partial_assembly_selection_never_reports_a_derived_total(self):
        facts = AssemblyFacts(
            "hash",
            "ASSEMBLY",
            1,
            "FRAME",
            no_authored_weight(),
            (part(entity_id=10), part(entity_id=11)),
            (10,),
        )
        row = mass.resolve_assembly(facts, mass.DensityTable("steel", {"Steel": 7850.0}))
        self.assertIsInstance(row.resolved, mass.Absent)
        self.assertEqual(row.resolved.reason, "partial_assembly_selection")

    def test_totals_deduplicate_rows_and_exclude_named_layout_assemblies(self):
        table = mass.DensityTable("steel", {"Steel": 7850.0})
        normal = mass.resolve_assembly(
            AssemblyFacts("hash", "A", 1, "FRAME", no_authored_weight(), (part(),), None),
            table,
        )
        excluded = mass.resolve_assembly(
            AssemblyFacts("hash", "B", 2, "DUMMY", no_authored_weight(), (part(entity_id=20),), None),
            table,
        )
        totals = mass.accumulate_totals((normal, normal, excluded)).resolved
        self.assertEqual(totals.n_counted, 1)
        self.assertEqual(totals.n_excluded, 1)
        self.assertAlmostEqual(totals.sum_kg, 62.8)


if __name__ == "__main__":
    unittest.main()
