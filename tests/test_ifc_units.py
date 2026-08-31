from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import ifc_service
import ifc_units


class Unit:
    def __init__(self, kind, *, name=None, prefix=None, factor=None, component=None):
        self.kind = kind
        self.Name = name
        self.Prefix = prefix
        self.UnitType = None
        self.ConversionFactor = None
        if factor is not None:
            value = type("Value", (), {"wrappedValue": factor})()
            self.ConversionFactor = type(
                "ConversionFactor",
                (),
                {"ValueComponent": value, "UnitComponent": component},
            )()

    def is_a(self, kind):
        return self.kind == kind


class IfcUnitConversionTests(unittest.TestCase):
    def test_length_and_mass_helpers_use_si_boundaries(self):
        self.assertEqual(ifc_units.lengths_to_m([1000, 250], 0.001), [1.0, 0.25])
        self.assertEqual(ifc_units.mass_to_kilograms(2500, 1.0), 2.5)

    def test_named_si_units_apply_linear_square_and_cubic_prefixes(self):
        with patch.object(
            ifc_units.ifcopenshell.util.unit,
            "get_prefix_multiplier",
            return_value=0.001,
        ):
            self.assertAlmostEqual(
                ifc_units.named_unit_scale_to_si(
                    Unit("IfcSIUnit", name="METRE", prefix="MILLI")
                ),
                0.001,
            )
            self.assertAlmostEqual(
                ifc_units.named_unit_scale_to_si(
                    Unit("IfcSIUnit", name="SQUARE_METRE", prefix="MILLI")
                ),
                0.000001,
            )
            self.assertAlmostEqual(
                ifc_units.named_unit_scale_to_si(
                    Unit("IfcSIUnit", name="CUBIC_METRE", prefix="MILLI")
                ),
                0.000000001,
            )

    def test_conversion_based_units_accumulate_the_conversion_factor(self):
        base = Unit("IfcSIUnit", name="GRAM", prefix=None)
        converted = Unit(
            "IfcConversionBasedUnit",
            factor=453.59237,
            component=base,
        )
        with patch.object(
            ifc_units.ifcopenshell.util.unit,
            "get_prefix_multiplier",
            return_value=1.0,
        ):
            self.assertAlmostEqual(
                ifc_units.named_unit_scale_to_si(converted),
                453.59237,
            )

    def test_compatibility_facade_reexports_the_unit_contract(self):
        self.assertIs(ifc_service.project_units, ifc_units.project_units)
        self.assertIs(ifc_service._lengths_to_m, ifc_units.lengths_to_m)


if __name__ == "__main__":
    unittest.main()
