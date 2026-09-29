from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import ifcopenshell
from pyproj import Transformer


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import ifc_elements
import ifc_georeference
import model_index


def fixture_model():
    return ifcopenshell.open(str(ROOT / "test-fixtures" / "phase3-bim.ifc"))


def add_map_conversion(model, *, crs_name="EPSG:25832", scale=0.001):
    context = model.by_type("IfcGeometricRepresentationContext")[0]
    metre = model.createIfcSIUnit(UnitType="LENGTHUNIT", Name="METRE")
    crs = model.create_entity("IfcProjectedCRS", Name=crs_name, MapUnit=metre)
    model.create_entity("IfcMapConversion", SourceCRS=context, TargetCRS=crs,
                        Eastings=500000.0, Northings=5300000.0,
                        OrthogonalHeight=120.0, Scale=scale)
    return context


class IfcGeoreferenceTests(unittest.TestCase):
    def test_missing_and_incomplete_reference_cannot_position_model(self):
        model = fixture_model()
        self.assertEqual(ifc_georeference.inspect_georeference(model), {
            "status": "unavailable", "source": None,
            "reason": "coordinate_operation_missing",
        })
        add_map_conversion(model, crs_name="")
        self.assertEqual(ifc_georeference.inspect_georeference(model)["reason"],
                         "projected_crs_missing")

    def test_projected_origin_accounts_for_wcs_and_model_units(self):
        model = fixture_model()
        context = add_map_conversion(model)
        context.WorldCoordinateSystem.Location.Coordinates = (1000.0, 0.0, 0.0)
        info = ifc_georeference.inspect_georeference(model)
        self.assertEqual(info["status"], "projected")
        self.assertEqual(info["source"], "ifc")
        self.assertEqual(info["crsName"], "EPSG:25832")
        self.assertEqual(info["mapUnit"], "m")
        self.assertEqual(info["mapConversion"]["eastings"], 500000.0)
        self.assertEqual(info["origin"], {
            "eastings": 499999.0, "northings": 5300000.0, "height": 120.0,
        })
        controls = info["wgs84"]["controlPoints"]
        expected_lon, expected_lat = Transformer.from_crs("EPSG:25832", "EPSG:4326",
                                                           always_xy=True).transform(499999, 5300000)
        self.assertAlmostEqual(controls["origin"]["longitude"], expected_lon, places=8)
        self.assertAlmostEqual(controls["origin"]["latitude"], expected_lat, places=8)
        self.assertEqual(controls["origin"]["elevationMeters"], 120)
        self.assertAlmostEqual(info["wgs84"]["projectUnitMeters"], 0.001)
        self.assertGreater(controls["east"]["longitude"], controls["origin"]["longitude"])

        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.sqlite"
            model_index.build_hot(
                model, target, "georeference-hash",
                ifc_elements.build_hot_record,
                lambda entity: [child.id() for child in ifc_elements.direct_children(entity)],
            )
            self.assertEqual(model_index.ModelIndex(target).georeference(), info)

    def test_invalid_scale_is_reported_without_failing_the_model(self):
        model = fixture_model()
        add_map_conversion(model, scale=-1.0)
        self.assertEqual(ifc_georeference.inspect_georeference(model)["reason"],
                         "invalid_coordinate_operation")

    def test_unresolvable_crs_keeps_projected_metadata_without_map_placement(self):
        model = fixture_model()
        add_map_conversion(model, crs_name="Local Grid")
        info = ifc_georeference.inspect_georeference(model)
        self.assertEqual(info["status"], "projected")
        self.assertIsNone(info["wgs84"])


if __name__ == "__main__":
    unittest.main()
