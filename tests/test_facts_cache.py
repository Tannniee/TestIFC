from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import facts_cache
from mass_facts import (
    AnalyticFacts,
    AuthoredVolumeFacts,
    MeshFacts,
    PartFacts,
    VolumeMeasureFact,
)


def part() -> PartFacts:
    return PartFacts(
        10,
        "PART-10",
        "IfcBeam",
        "PL 10x200",
        "Steel",
        (110,),
        MeshFacts(0.008, 4.0, (210,)),
        0.001,
        AuthoredVolumeFacts(
            (VolumeMeasureFact(8_000_000.0, 310, "NetVolume", "project_volume_unit", 1e-9),),
            (),
            True,
        ),
        AnalyticFacts(0.008, 4.0, (410, 411), "ifc_extruded_area_solid"),
    )


class FactsCacheTests(unittest.TestCase):
    def test_round_trip_keeps_raw_density_independent_provenance(self):
        with TemporaryDirectory() as temporary:
            target = facts_cache.path_for(Path(temporary), "hash-a")
            cache = facts_cache.FactsCache(target, "hash-a")

            self.assertIsNone(cache.get_part(10))
            cache.put_part(part())
            restored = cache.get_part(10)

            self.assertEqual(restored, part())
            self.assertIn(".facts-v1", target.name)

    def test_algorithm_version_change_invalidates_rows_without_deleting_file(self):
        with TemporaryDirectory() as temporary:
            cache = facts_cache.FactsCache(
                facts_cache.path_for(Path(temporary), "hash-b"), "hash-b"
            )
            cache.put_part(part())
            original = facts_cache.FACTS_ALGORITHM_VERSION
            try:
                facts_cache.FACTS_ALGORITHM_VERSION = original + 1
                self.assertIsNone(cache.get_part(10))
            finally:
                facts_cache.FACTS_ALGORITHM_VERSION = original


if __name__ == "__main__":
    unittest.main()
