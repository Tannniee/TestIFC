"""Research experiment using the existing Colorizer, not an IFC Lite integration test."""
from __future__ import annotations

import hashlib
import json
import sys
import time
from collections import Counter
from dataclasses import asdict
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.ifcopenshell_wrapper as wrapper
import numpy as np

COLORIZER = Path(r"F:\Steel\VBA\IFC COLO\recovered_source")
sys.path.insert(0, str(COLORIZER))
from colorizer_core import export_groups, load_section_groups, styled_leaf_items
from colorizer_palette import PaletteStore

OUT = Path(__file__).resolve().parent
SOURCE = Path(r"F:\Steel\VBA\IFC COLO\hangarvd_f10_ tan base_f01_colored.ifc")
GROUP = "PIPE-267.4X8"
GRAY = (128 / 255, 128 / 255, 128 / 255)
RED = (1.0, 0.0, 0.0)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def styles_for(item):
    for styled in item.StyledByItem:
        for candidate in styled.Styles:
            if candidate.is_a("IfcPresentationStyleAssignment"):
                yield from candidate.Styles
            else:
                yield candidate


def colors_for(element):
    values = []
    for item in styled_leaf_items(element):
        found = []
        for style in styles_for(item):
            if not style.is_a("IfcSurfaceStyle"):
                continue
            for part in style.Styles:
                if part.is_a("IfcSurfaceStyleShading"):
                    c = part.SurfaceColour
                    found.append(((c.Red, c.Green, c.Blue), getattr(part, "Transparency", 0.0) or 0.0))
        assert len(found) == 1, (element.id(), item.id(), found)
        values.extend(found)
    assert values, element.id()
    return values


def check_all(model, ids, red_ids):
    item_count = 0
    for entity_id in ids:
        expected = RED if entity_id in red_ids else GRAY
        for rgb, transparency in colors_for(model.by_id(entity_id)):
            assert np.allclose(rgb, expected, rtol=0, atol=1e-10), (entity_id, rgb, expected)
            assert transparency == 0.0, (entity_id, transparency)
            item_count += 1
    return {"members": len(ids), "items": item_count, "red": len(red_ids), "gray": len(ids) - len(red_ids)}


def geometry_check(source_model, final_model, sample_ids, red_ids):
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    results = []
    for entity_id in sample_ids:
        before = ifcopenshell.geom.create_shape(settings, source_model.by_id(entity_id))
        after = ifcopenshell.geom.create_shape(settings, final_model.by_id(entity_id))
        av, bv = np.array(before.geometry.verts), np.array(after.geometry.verts)
        af, bf = np.array(before.geometry.faces), np.array(after.geometry.faces)
        assert av.shape == bv.shape and np.allclose(av, bv, rtol=0, atol=1e-10), entity_id
        assert np.array_equal(af, bf), entity_id
        expected = RED if entity_id in red_ids else GRAY
        actual = [(material.diffuse.r(), material.diffuse.g(), material.diffuse.b()) for material in after.geometry.materials]
        assert actual and all(np.allclose(rgb, expected, rtol=0, atol=1e-7) for rgb in actual), (entity_id, actual)
        results.append({"expressId": entity_id, "vertices": len(av) // 3, "triangles": len(af) // 3, "materials": actual})
    return results


def main():
    started = time.perf_counter()
    source_hash = digest(SOURCE)
    model, groups = load_section_groups(str(SOURCE), palette=PaletteStore(OUT / "probe-palette.json"))
    ids = sorted(e.id() for g in groups for e in g.elements)
    red_ids = {e.id() for g in groups if g.name == GROUP for e in g.elements}
    assert red_ids and len(ids) == len(set(ids))
    initial_colors = Counter(tuple(round(v, 7) for v in rgb) for entity_id in ids for rgb, _ in colors_for(model.by_id(entity_id)))
    assert len(initial_colors) > 1, "The experiment requires an already multicolored input."
    print(f"Input: {len(ids)} members, {len(groups)} groups, {len(initial_colors)} colors", flush=True)

    gray_path = OUT / "01-all-gray.ifc"
    for group in groups:
        group.color, group.transparency, group.enabled = "#808080", 0.0, True
    gray_report = export_groups(str(SOURCE), groups, str(gray_path))
    gray_model, gray_groups = load_section_groups(str(gray_path), palette=PaletteStore(OUT / "probe-palette-gray.json"))
    gray_check = check_all(gray_model, ids, set())
    print(f"Reopened gray output: {gray_check}", flush=True)

    final_path = OUT / "02-gray-red.ifc"
    for group in gray_groups:
        group.enabled = group.name == GROUP
        if group.enabled:
            group.color, group.transparency = "#ff0000", 0.0
    red_report = export_groups(str(gray_path), gray_groups, str(final_path))
    final_model = ifcopenshell.open(str(final_path))
    final_check = check_all(final_model, ids, red_ids)
    print(f"Reopened red override: {final_check}", flush=True)

    presentation = {"IfcStyledItem", "IfcSurfaceStyle", "IfcSurfaceStyleShading", "IfcSurfaceStyleRendering", "IfcColourRgb", "IfcPresentationStyleAssignment"}
    non_presentation = [e for e in model if e.is_a() not in presentation]
    for entity in non_presentation:
        assert str(entity) == str(final_model.by_id(entity.id())), entity.id()
    assert {e.id() for e in final_model if e.is_a() not in presentation} == {e.id() for e in non_presentation}

    sample_ids = sorted(red_ids)[:6] + sorted(set(ids) - red_ids)[:6]
    shapes = geometry_check(model, final_model, sample_ids, red_ids)
    schema_results = {}
    for schema_name in ("IFC2X3", "IFC4"):
        schema = wrapper.schema_by_name(schema_name)
        attributes = [a.name() for a in schema.declaration_by_name("IfcSurfaceStyleShading").all_attributes()]
        fixture = ifcopenshell.file(schema=schema_name)
        color = fixture.create_entity("IfcColourRgb", None, 1.0, 0.0, 0.0)
        try:
            fixture.create_entity("IfcSurfaceStyleShading", color, 0.35)
            accepted, error = True, None
        except (TypeError, RuntimeError, ValueError) as exc:
            accepted, error = False, str(exc)
        schema_results[schema_name] = {"shading_attributes": attributes, "two_argument_shading_accepted": accepted, "error": error}
    assert not schema_results["IFC2X3"]["two_argument_shading_accepted"]
    assert schema_results["IFC4"]["two_argument_shading_accepted"]
    assert digest(SOURCE) == source_hash

    report = {
        "scope": "Existing Python Colorizer + independent IfcOpenShell geometry/material readback; no IFC Lite UI or renderer validation",
        "ifcopenshell": ifcopenshell.version,
        "source": str(SOURCE), "source_sha256": source_hash, "schema": model.schema,
        "initial_colors": len(initial_colors), "groups": len(groups), "selected_group": GROUP,
        "gray_export": asdict(gray_report), "gray_readback": gray_check,
        "final_export": asdict(red_report), "final_readback": final_check,
        "non_presentation_records_unchanged": len(non_presentation),
        "world_geometry_and_render_material_samples": shapes,
        "schema_probe": schema_results,
        "source_unchanged": True,
        "outputs": [{"path": str(p), "bytes": p.stat().st_size, "sha256": digest(p)} for p in (gray_path, final_path)],
        "elapsed_seconds_not_a_performance_benchmark": round(time.perf_counter() - started, 3),
    }
    (OUT / "probe-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("final_readback", "non_presentation_records_unchanged", "source_unchanged", "schema_probe")}, indent=2), flush=True)


if __name__ == "__main__":
    main()
