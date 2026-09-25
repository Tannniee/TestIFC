"""Diagnose face-ring containment from inspect_face_containment.py output."""

import json
import sys
from pathlib import Path

from shapely.geometry import Polygon
from shapely.ops import unary_union


faces = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
result = []
for face in faces:
    outer_ring = next(ring for ring in face["rings"] if ring["outer"])
    outer = Polygon([(point[0], point[1]) for point in outer_ring["vertices"]])
    holes = []
    hole_polygons = []
    for ring in face["rings"]:
        if ring["outer"]:
            continue
        polygon = Polygon([(point[0], point[1]) for point in ring["vertices"]])
        hole_polygons.append(polygon)
        holes.append({
            "boundId": ring["boundId"],
            "valid": polygon.is_valid,
            "area": polygon.area,
            "coveredByOuter": outer.covers(polygon),
            "withinOuter": polygon.within(outer),
            "intersectionArea": outer.intersection(polygon).area,
            "distance": outer.distance(polygon),
            "bounds": polygon.bounds,
        })
    result.append({
        "faceId": face["faceId"],
        "outerValid": outer.is_valid,
        "outerArea": outer.area,
        "areaAfterHoleUnion": outer.difference(unary_union(hole_polygons)).area,
        "sumInsideHoleArea": sum(polygon.area for polygon in hole_polygons if outer.covers(polygon)),
        "holeOverlaps": sum(
            1 for left in range(len(hole_polygons)) for right in range(left + 1, len(hole_polygons))
            if hole_polygons[left].intersects(hole_polygons[right])
        ),
        "outerBounds": outer.bounds,
        "holes": holes,
    })
print(json.dumps(result, indent=2))
