"""Small adversarial fixtures for the proposed uniform-colour contract."""
import importlib.util
import json
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.api.style
import ifcopenshell.geom

ROOT = Path(__file__).resolve().parent
CORE = Path(r"F:\Steel\VBA\IFC COLO\recovered_source")
sys.path.insert(0, str(CORE))
from colorizer_core import create_style, export_groups, group_model

spec = importlib.util.spec_from_file_location("colorizer_fixture", CORE / "tests" / "test_core.py")
fixture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)


def geometry_materials(element):
    shape = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), element)
    return [(m.diffuse.r(), m.diffuse.g(), m.diffuse.b()) for m in shape.geometry.materials]


def mapped_roundtrip():
    model, elements = fixture_module.fixture(mapped=True)
    source = ROOT / "mapped-input.ifc"
    gray = ROOT / "mapped-gray.ifc"
    final = ROOT / "mapped-gray-red.ifc"
    model.write(str(source))
    groups = group_model(model, "class")
    for group in groups:
        group.color = "#808080"
    export_groups(str(source), groups, str(gray))
    gray_model = ifcopenshell.open(str(gray))
    groups = group_model(gray_model, "class")
    for group in groups:
        group.enabled = group.name == "IfcBeam"
        group.color = "#ff0000"
    export_groups(str(gray), groups, str(final))
    result = ifcopenshell.open(str(final))
    colors = {e.is_a(): geometry_materials(result.by_id(e.id())) for e in elements}
    assert colors["IfcBeam"] == [(1.0, 0.0, 0.0)]
    assert colors["IfcColumn"] == [(128 / 255,) * 3]
    return {"colors": colors, "input_bytes": source.stat().st_size, "final_bytes": final.stat().st_size}


def mapped_parent_override():
    model, elements = fixture_module.fixture(mapped=True)
    leaf = elements[0].Representation.Representations[0].Items[0].MappingSource.MappedRepresentation.Items[0]
    gray = create_style(model, "shared gray", "#808080")
    red = create_style(model, "occurrence red", "#ff0000")
    ifcopenshell.api.style.assign_item_style(model, item=leaf, style=gray)
    mapped = elements[0].Representation.Representations[0].Items[0]
    ifcopenshell.api.style.assign_item_style(model, item=mapped, style=red)
    path = ROOT / "mapped-parent-red-leaf-gray.ifc"
    model.write(str(path))
    reopened = ifcopenshell.open(str(path))
    colors = {e.is_a(): geometry_materials(reopened.by_id(e.id())) for e in elements}
    assert colors["IfcBeam"] == [(128 / 255,) * 3], colors
    return {"requested_beam": "#ff0000", "observed_colors": colors,
            "occurrence_parent_style_overrode_existing_leaf_style": False}


def indexed_override():
    model, elements = fixture_module.fixture()
    coordinates = model.create_entity("IfcCartesianPointList3D", CoordList=((0., 0., 0.), (1., 0., 0.), (0., 1., 0.), (0., 0., 1.)))
    faces = model.create_entity("IfcTriangulatedFaceSet", Coordinates=coordinates, Closed=True,
                                CoordIndex=((1, 3, 2), (1, 2, 4), (2, 3, 4), (3, 1, 4)))
    palette = model.create_entity("IfcColourRgbList", ColourList=((0., 0., 1.), (0., 1., 0.)))
    model.create_entity("IfcIndexedColourMap", MappedTo=faces, Opacity=1.0, Colours=palette, ColourIndex=(1, 2, 1, 2))
    representation = elements[0].Representation.Representations[0]
    representation.RepresentationType = "Tessellation"
    representation.Items = [faces]
    source, final = ROOT / "indexed-input.ifc", ROOT / "indexed-after-gray-style.ifc"
    model.write(str(source))
    groups = group_model(model, "class")
    for group in groups:
        group.enabled = group.name == "IfcBeam"
        group.color = "#808080"
    export_groups(str(source), groups, str(final))
    reopened = ifcopenshell.open(str(final))
    actual = geometry_materials(reopened.by_id(elements[0].id()))
    original_materials = geometry_materials(ifcopenshell.open(str(source)).by_id(elements[0].id()))
    assert len(reopened.by_type("IfcIndexedColourMap")) == 1
    return {"requested": "#808080", "independent_engine_materials": actual,
            "indexed_colour_maps_remaining": len(reopened.by_type("IfcIndexedColourMap")),
            "input_engine_materials": original_materials,
            "oracle_limit": "IfcOpenShell 0.8.5 did not expose the indexed palette as geometry materials even before recolouring. This run proves only that the indexed map remains attached. IFC Lite source explicitly uses it for palette splits."}


report = {"scope": "Existing Colorizer and synthetic IFC4 geometry; not IFC Lite runtime",
          "mapped_two_pass": mapped_roundtrip(), "mapped_parent_style_vs_leaf_style": mapped_parent_override(),
          "indexed_map_survives_style_replacement": indexed_override()}
(ROOT / "edge-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
