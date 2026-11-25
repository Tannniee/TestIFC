"""Independent readback of Rust exports. IfcOpenShell is a test oracle only."""
import hashlib
import json
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import numpy as np

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "rust"
SOURCE = Path(r"F:\Steel\VBA\IFC COLO\hangarvd_f10_ tan base_f01_colored.ifc")
catalog = json.loads((OUT / "catalog.json").read_text())
ids = catalog["productIds"]
red = {i for g in catalog["groups"] if g["name"] == "PIPE-267.4X8" for i in g["products"]}
original = ifcopenshell.open(str(SOURCE))
gray = ifcopenshell.open(str(OUT / "01-all-gray.ifc"))
final = ifcopenshell.open(str(OUT / "02-gray-red.ifc"))


def surface_colors(element):
    colors = []
    # SAP2000 fixture has one swept Body and one Axis polyline per member.
    # The solid-colour contract changes 3D surfaces, preserving Axis styling.
    for representation in element.Representation.Representations:
        if representation.RepresentationIdentifier != "Body":
            continue
        for item in representation.Items:
            assert len(item.StyledByItem) == 1
            for style in item.StyledByItem[0].Styles:
                if style.is_a("IfcSurfaceStyle"):
                    for appearance in style.Styles:
                        if appearance.is_a("IfcSurfaceStyleShading"):
                            c = appearance.SurfaceColour
                            colors.append((c.Red, c.Green, c.Blue, 1 - (getattr(appearance, "Transparency", 0) or 0)))
    assert colors
    return colors


for entity_id in ids:
    assert all(np.allclose(c, (128/255,)*3+(1,), rtol=0, atol=1e-10) for c in surface_colors(gray.by_id(entity_id)))
    expected = (1.,0.,0.,1.) if entity_id in red else (128/255,)*3+(1.,)
    assert all(np.allclose(c, expected, rtol=0, atol=1e-10) for c in surface_colors(final.by_id(entity_id))), entity_id

ignore = {"IfcStyledItem", "IfcSurfaceStyle", "IfcSurfaceStyleShading", "IfcSurfaceStyleRendering", "IfcColourRgb", "IfcPresentationStyleAssignment"}
unchanged = [e for e in original if e.is_a() not in ignore]
assert all(str(e) == str(final.by_id(e.id())) for e in unchanged)
assert {e.id() for e in unchanged} == {e.id() for e in final if e.is_a() not in ignore}
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, True)
samples = []
for entity_id in sorted(red)[:6] + sorted(set(ids)-red)[:6]:
    a = ifcopenshell.geom.create_shape(settings, original.by_id(entity_id))
    b = ifcopenshell.geom.create_shape(settings, final.by_id(entity_id))
    assert np.allclose(a.geometry.verts, b.geometry.verts, rtol=0, atol=1e-10)
    assert tuple(a.geometry.faces) == tuple(b.geometry.faces)
    materials = [(m.diffuse.r(),m.diffuse.g(),m.diffuse.b()) for m in b.geometry.materials]
    expected = (1.,0.,0.) if entity_id in red else (128/255,)*3
    assert all(np.allclose(c, expected, rtol=0, atol=1e-7) for c in materials)
    samples.append({"expressId":entity_id,"materials":materials,"triangles":len(b.geometry.faces)//3})

report = {"engine":"Rust ifc-lite-export Colorizer; independently read by IfcOpenShell 0.8.5",
          "groups":len(catalog["groups"]),"gray_objects":len(ids),"final_red":len(red),"final_gray":len(ids)-len(red),
          "surface_items_verified":sum(len(surface_colors(final.by_id(i))) for i in ids),
          "non_presentation_records_unchanged":len(unchanged),"geometry_samples":samples,
          "source_sha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
          "outputs":[{"file":f,"sha256":hashlib.sha256((OUT/f).read_bytes()).hexdigest(),"bytes":(OUT/f).stat().st_size}
                     for f in ("01-all-gray.ifc","02-gray-red.ifc")]}
(OUT / "oracle.json").write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k != "geometry_samples"},indent=2))
