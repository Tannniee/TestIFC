"""Read IFC map positioning without changing model or viewer coordinates."""

from __future__ import annotations

import logging
import math
from typing import Any

import ifcopenshell.util.geolocation
import ifcopenshell.util.unit


logger = logging.getLogger(__name__)


def _unavailable(reason: str) -> dict[str, Any]:
    return {"status": "unavailable", "source": None, "reason": reason}


def inspect_georeference(ifc_file: Any) -> dict[str, Any]:
    """Report a projected IFC origin; WGS84 conversion belongs to the map slice.

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
        }
    except (AttributeError, TypeError, ValueError, RuntimeError):
        logger.warning("Invalid IFC georeference metadata", exc_info=True)
        return _unavailable("invalid_georeference")
