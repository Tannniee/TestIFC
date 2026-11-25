"""Independent test oracle for the actual native UI download; no app runtime dependency."""
from pathlib import Path
import hashlib
import json
import sys
import ifcopenshell
import ifcopenshell.geom
import numpy as np

ROOT = Path(__file__).resolve().parent
SOURCE = Path(r"F:\Steel\VBA\IFC COLO\hangarvd_f10_ tan base_f01_colored.ifc")
OUTPUT = ROOT / "quality-candidate-1/audit-gray.ifc"
catalog = json.loads(Path(r"F:/Steel/VBA/IFC-Lite-Core104/research/colorizer-20261015/rust/catalog.json").read_text())
ids = catalog["productIds"]
red = set()
if len(sys.argv) > 3:
    red = set(json.loads((OUTPUT.parent / sys.argv[3]).read_text()))
original = ifcopenshell.open(str(SOURCE))
final = ifcopenshell.open(str(OUTPUT))

def body_colors(element):
    colors = []
    for rep in element.Representation.Representations:
        if rep.RepresentationIdentifier != "Body":
            continue
        for item in rep.Items:
            assert len(item.StyledByItem) == 1
            for style in item.StyledByItem[0].Styles:
                if style.is_a("IfcPresentationStyleAssignment"):
                    styles = style.Styles
                else:
                    styles = [style]
                for style in styles:
                    if style.is_a("IfcSurfaceStyle"):
                        for appearance in style.Styles:
                            if appearance.is_a("IfcSurfaceStyleShading"):
                                c = appearance.SurfaceColour
                                colors.append((c.Red, c.Green, c.Blue, 1 - (getattr(appearance, "Transparency", 0) or 0)))
    assert colors
    return colors

for entity_id in ids:
    expected = (1., 0., 0., 1.) if entity_id in red else (128/255,)*3+(1.,)
    assert all(np.allclose(c, expected, rtol=0, atol=1e-10) for c in body_colors(final.by_id(entity_id))), entity_id

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
    expected = (1., 0., 0.) if entity_id in red else (128/255,)*3
    assert all(np.allclose((m.diffuse.r(),m.diffuse.g(),m.diffuse.b()), expected, rtol=0, atol=1e-7) for m in b.geometry.materials)
    samples.append({"expressId": entity_id, "triangles": len(b.geometry.faces)//3})

source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
assert source_hash == "df595b8d150b09dabbc48e21f6efd1b26a0f35ab07636a02d0b51896b94894a2"
report = {"oracle": "IfcOpenShell " + ifcopenshell.version, "output": str(OUTPUT),
          "red": len(red), "gray": len(ids)-len(red), "body_items": sum(len(body_colors(final.by_id(i))) for i in ids),
          "non_presentation_records_unchanged": len(unchanged), "geometry_samples": samples,
          "source_sha256": source_hash, "output_sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), "bytes": OUTPUT.stat().st_size}
(OUTPUT.parent / "colorizer-oracle.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
