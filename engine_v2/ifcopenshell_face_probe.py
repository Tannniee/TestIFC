"""Read-only independent geometry check for selected products in a real IFC."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom


source = Path(sys.argv[1]).resolve()
product_ids = [int(value) for value in sys.argv[2:]]
started = time.perf_counter()
model = ifcopenshell.open(str(source))
open_seconds = time.perf_counter() - started
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, True)
results = []
for product_id in product_ids:
    product = model.by_id(product_id)
    entry = {"expressId": product_id, "type": product.is_a()}
    tick = time.perf_counter()
    try:
        shape = ifcopenshell.geom.create_shape(settings, product)
        geometry = shape.geometry
        vertices = geometry.verts
        faces = geometry.faces
        entry.update({
            "vertexCount": len(vertices) // 3,
            "triangleCount": len(faces) // 3,
            "bounds": [[min(vertices[axis::3]), max(vertices[axis::3])] for axis in range(3)],
        })
    except Exception as exc:
        entry["error"] = f"{type(exc).__name__}: {exc}"
    entry["geometrySeconds"] = time.perf_counter() - tick
    results.append(entry)
print(json.dumps({"source": str(source), "openSeconds": open_seconds, "products": results}, indent=2))
