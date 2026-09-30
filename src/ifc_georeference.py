"""Read IFC map positioning without changing model or viewer coordinates."""

from __future__ import annotations

import logging
import math
from typing import Any

import ifcopenshell.util.geolocation
import ifcopenshell.util.unit
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError, ProjError


logger = logging.getLogger(__name__)


def _unavailable(reason: str) -> dict[str, Any]:
    return {"status": "unavailable", "source": None, "reason": reason}


def _wgs84_control_points(ifc_file: Any, crs_name: str, map_unit: str | None) -> dict[str, Any] | None:
    """Project the engineering origin and three basis points without guessing a CRS."""
    if not crs_name.upper().startswith("EPSG:") or not crs_name[5:].isdigit():
        return None
    try:
        crs = CRS.from_user_input(crs_name)
        if not crs.is_projected or not crs.axis_info:
            return None
        # IFC map units and the referenced EPSG's units must agree. Other units
        # need an explicit conversion, rather than silently shifting the site.
        if map_unit not in (None, "m") or not math.isclose(crs.axis_info[0].unit_conversion_factor, 1):
            return None
        transformer = Transformer.from_crs(crs, CRS.from_epsg(4326), always_xy=True,
                                           allow_ballpark=False, only_best=True)
        project_unit_meters = ifcopenshell.util.unit.calculate_unit_scale(ifc_file)
        if not math.isfinite(project_unit_meters) or project_unit_meters <= 0:
            return None
        metre_in_project_units = 1 / project_unit_meters
        points = {
            "origin": (0, 0, 0),
            "east": (metre_in_project_units, 0, 0),
            "north": (0, metre_in_project_units, 0),
            "up": (0, 0, metre_in_project_units),
        }
        converted = {}
        for name, point in points.items():
            east, north, height = ifcopenshell.util.geolocation.auto_xyz2enh(ifc_file, *point)
            longitude, latitude = transformer.transform(east, north, errcheck=True)
            if not all(math.isfinite(value) for value in (longitude, latitude, height)):
                return None
            if abs(longitude) > 180 or abs(latitude) >= 85.05112878:
                return None
            converted[name] = {"longitude": longitude, "latitude": latitude,
                               "elevationMeters": height}
        origin = converted["origin"]
        if any(abs(point["longitude"] - origin["longitude"]) > 0.1
               or abs(point["latitude"] - origin["latitude"]) > 0.1
               for point in converted.values()):
            return None
        return {"controlPoints": converted, "projectUnitMeters": project_unit_meters,
                "verticalDatumVerified": False}
    except (CRSError, ProjError, ValueError, OverflowError):
        logger.warning("Unable to transform IFC projected CRS to WGS84", exc_info=True)
        return None


def inspect_georeference(ifc_file: Any) -> dict[str, Any]:
    """Report the IFC projected origin and WGS84 control points when resolvable.

    IfcOpenShell's auto conversion accounts for IFC project length units and WCS.
    A partial or malformed coordinate operation cannot establish a map position.
    """
    if not getattr(ifc_file, "schema", None):
        return _unavailable("coordinate_operation_missing")
    try:
        crs = ifcopenshell.util.geolocation.get_crs(ifc_file)
        transform = ifcopenshell.util.geolocation.get_helmert_transformation_parameters(ifc_file)
        if transform is None:
            return _unavailable("coordinate_operation_missing")
        if not crs or crs.get("type") != "IfcProjectedCRS" or not crs.get("Name"):
            return _unavailable("projected_crs_missing")
        values = (transform.e, transform.n, transform.h, transform.xaa,
                  transform.xao, transform.scale, transform.factor_x,
                  transform.factor_y, transform.factor_z)
        if not all(math.isfinite(float(value)) for value in values):
            return _unavailable("invalid_coordinate_operation")
        if transform.scale <= 0 or math.hypot(transform.xaa, transform.xao) == 0:
            return _unavailable("invalid_coordinate_operation")
        origin = tuple(float(value) for value in
                       ifcopenshell.util.geolocation.auto_xyz2enh(ifc_file, 0, 0, 0))
        if not all(math.isfinite(value) for value in origin):
            return _unavailable("invalid_coordinate_operation")
        map_unit = crs.get("MapUnit")
        return {
            "status": "projected",
            "source": "ifc",
            "crsName": str(crs["Name"]),
            "mapUnit": (ifcopenshell.util.unit.get_unit_symbol(map_unit)
                        if map_unit is not None and hasattr(map_unit, "is_a") else None),
            "origin": {"eastings": origin[0], "northings": origin[1], "height": origin[2]},
            "mapConversion": {
                "eastings": float(transform.e),
                "northings": float(transform.n),
                "height": float(transform.h),
                "xAxisAbscissa": float(transform.xaa),
                "xAxisOrdinate": float(transform.xao),
                "scale": float(transform.scale),
                "factorX": float(transform.factor_x),
                "factorY": float(transform.factor_y),
                "factorZ": float(transform.factor_z),
            },
            "wgs84": _wgs84_control_points(ifc_file, str(crs["Name"]),
                                           (ifcopenshell.util.unit.get_unit_symbol(map_unit)
                                            if map_unit is not None and hasattr(map_unit, "is_a") else None)),
        }
    except (AttributeError, TypeError, ValueError, RuntimeError):
        logger.warning("Invalid IFC georeference metadata", exc_info=True)
        return _unavailable("invalid_georeference")
