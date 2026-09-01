"""Generate a local IFC4 model for repeatable fragment-profile smoke tests."""

from __future__ import annotations

import argparse
from pathlib import Path

import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit


def build(output: Path) -> None:
    model = ifcopenshell.api.project.create_file("IFC4")
    project = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcProject", name="Phase 3 Benchmark"
    )
    site = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSite", name="Site")
    building = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcBuilding", name="Building"
    )
    storey = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcBuildingStorey", name="Level 1"
    )
    beam = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcBeam", name="Synthetic Beam"
    )
    beam.ObjectType = "PL 10x200"

    ifcopenshell.api.unit.assign_unit(model)
    mass_unit = ifcopenshell.api.unit.add_si_unit(
        model, unit_type="MASSUNIT", prefix="KILO"
    )
    ifcopenshell.api.unit.assign_unit(model, units=[mass_unit])
    model_context = ifcopenshell.api.context.add_context(model, context_type="Model")
    body = ifcopenshell.api.context.add_context(
        model,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model_context,
    )

    ifcopenshell.api.aggregate.assign_object(model, products=[site], relating_object=project)
    ifcopenshell.api.aggregate.assign_object(model, products=[building], relating_object=site)
    ifcopenshell.api.aggregate.assign_object(model, products=[storey], relating_object=building)
    ifcopenshell.api.spatial.assign_container(
        model, products=[beam], relating_structure=storey
    )

    profile = model.createIfcRectangleProfileDef(
        "AREA", "PL 10x200", None, 200.0, 10.0
    )
    representation = ifcopenshell.api.geometry.add_profile_representation(
        model, context=body, profile=profile, depth=4.0
    )
    ifcopenshell.api.geometry.assign_representation(
        model, product=beam, representation=representation
    )

    steel = ifcopenshell.api.material.add_material(
        model, name="Steel", category="steel"
    )
    ifcopenshell.api.material.assign_material(
        model, products=[beam], type="IfcMaterial", material=steel
    )
    pset = ifcopenshell.api.pset.add_pset(
        model, product=beam, name="Pset_Phase3Benchmark"
    )
    ifcopenshell.api.pset.edit_pset(
        model,
        pset=pset,
        properties={"Description": "Fragment metadata A/B", "Profile": "PL 10x200"},
    )
    qto = ifcopenshell.api.pset.add_qto(
        model, product=beam, name="Qto_BeamBaseQuantities"
    )
    ifcopenshell.api.pset.edit_qto(
        model, qto=qto, properties={"Length": 4.0, "NetVolume": 0.008}
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(output))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "test-fixtures"
        / "phase3-synthetic.ifc",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    build(output)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
