"""IFC unit resolution and quantity normalization.

This module has no dependency on model cache or active-model state. Domain
modules can use it without pulling in the model runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import ifcopenshell.util.unit
import numpy as np


def lengths_to_m(values: Any, length_scale: float) -> list:
    """Convert one or more project length values to metres."""
    return (np.asarray(values, dtype=float) * length_scale).tolist()


def mass_to_kilograms(mass_in_project_units: float, mass_scale: float) -> float:
    """Convert a mass value to kilograms from an IFC scale expressed in grams."""
    return mass_in_project_units * mass_scale / 1000.0


def has_unit_type(ifc_file: Any, unit_type: str) -> bool:
    projects = ifc_file.by_type("IfcProject")
    if not projects or not projects[0].UnitsInContext:
        return False
    return any(
        getattr(unit, "UnitType", None) == unit_type
        for unit in projects[0].UnitsInContext.Units
    )


def named_unit_scale_to_si(unit: Any) -> float | None:
    """Return an IFC named unit's scale to its SI base unit."""
    scale = 1.0
    current = unit
    while current.is_a("IfcConversionBasedUnit"):
        conversion_factor = current.ConversionFactor
        scale *= float(conversion_factor.ValueComponent.wrappedValue)
        current = conversion_factor.UnitComponent
    if not current.is_a("IfcSIUnit"):
        return None

    prefix_scale = ifcopenshell.util.unit.get_prefix_multiplier(current.Prefix)
    unit_name = str(current.Name or "")
    if "SQUARE" in unit_name:
        scale *= prefix_scale**2
    elif "CUBIC" in unit_name:
        scale *= prefix_scale**3
    else:
        scale *= prefix_scale
    return scale


def project_unit_scale_to_si(
    ifc_file: Any,
    unit_type: str,
    length_scale: float,
) -> float | None:
    project_unit = ifcopenshell.util.unit.get_project_unit(ifc_file, unit_type)
    if project_unit is not None:
        return named_unit_scale_to_si(project_unit)
    if unit_type == "LENGTHUNIT":
        return length_scale
    if unit_type == "AREAUNIT":
        return length_scale**2
    if unit_type == "VOLUMEUNIT":
        return length_scale**3
    return None


@dataclass(frozen=True)
class ProjectUnits:
    length_scale: float
    has_mass_unit: bool
    mass_scale: float
    si_scale: dict[str, float | None]


def project_units(ifc_file: Any) -> ProjectUnits:
    length_scale = ifcopenshell.util.unit.calculate_unit_scale(ifc_file)
    return ProjectUnits(
        length_scale=length_scale,
        has_mass_unit=has_unit_type(ifc_file, "MASSUNIT"),
        mass_scale=ifcopenshell.util.unit.calculate_unit_scale(ifc_file, "MASSUNIT"),
        si_scale={
            unit_type: project_unit_scale_to_si(ifc_file, unit_type, length_scale)
            for unit_type in ("LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT", "MASSUNIT")
        },
    )


def _quantity_value_field(quantity: Any) -> tuple[str, str] | None:
    if quantity.is_a("IfcQuantityLength"):
        return "LengthValue", "LENGTHUNIT"
    if quantity.is_a("IfcQuantityArea"):
        return "AreaValue", "AREAUNIT"
    if quantity.is_a("IfcQuantityVolume"):
        return "VolumeValue", "VOLUMEUNIT"
    if quantity.is_a("IfcQuantityWeight"):
        return "WeightValue", "MASSUNIT"
    return None


def _quantity_value_to_display_unit(
    value: float,
    quantity: Any,
    units: ProjectUnits,
    unit_type: str,
) -> tuple[float, str] | None:
    explicit_unit = getattr(quantity, "Unit", None)
    scale = (
        named_unit_scale_to_si(explicit_unit)
        if explicit_unit is not None
        else units.si_scale[unit_type]
    )
    if scale is None:
        return None
    if unit_type == "MASSUNIT":
        return mass_to_kilograms(value, scale), "mass"
    if unit_type == "AREAUNIT":
        return value * scale, "area"
    if unit_type == "VOLUMEUNIT":
        return value * scale, "volume"
    return value * scale, "length"


def normalize_quantities(
    element: Any,
    quantities: dict,
    units: ProjectUnits,
) -> tuple[dict, set[str]]:
    """Normalize IFC quantities and report the resolved display-unit kinds."""
    normalized = {set_name: dict(qto) for set_name, qto in quantities.items()}
    resolved_unit_kinds = set()

    for relation in getattr(element, "IsDefinedBy", []) or []:
        if not relation.is_a("IfcRelDefinesByProperties"):
            continue
        qset = relation.RelatingPropertyDefinition
        if qset is None or not qset.is_a("IfcElementQuantity"):
            continue
        set_name = qset.Name or "Quantities"
        target = normalized.setdefault(set_name, {})
        for quantity in qset.Quantities or []:
            field = _quantity_value_field(quantity)
            if field is None:
                continue
            quantity_name = quantity.Name
            if not quantity_name:
                continue
            value_field, unit_type = field
            raw_value = getattr(quantity, value_field, None)
            if not isinstance(raw_value, int | float):
                continue
            converted = _quantity_value_to_display_unit(
                float(raw_value), quantity, units, unit_type
            )
            if converted is None:
                continue
            target[quantity_name] = converted[0]
            resolved_unit_kinds.add(converted[1])
    return normalized, resolved_unit_kinds


# Compatibility aliases for code that still uses the recovered private names.
_lengths_to_m = lengths_to_m
_to_kilograms = mass_to_kilograms
_has_unit_type = has_unit_type
_named_unit_scale_to_si = named_unit_scale_to_si
_project_unit_scale_to_si = project_unit_scale_to_si
_normalise_quantities = normalize_quantities
