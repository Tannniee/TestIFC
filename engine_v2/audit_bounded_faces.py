"""Diagnose problematic IFC face loops without loading the whole IFC model."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

from shapely.geometry import Polygon
from shapely import make_valid
from shapely.validation import explain_validity


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("index", type=Path)
    parser.add_argument("face_ids", nargs="+", type=int)
    args = parser.parse_args()
    raw = subprocess.check_output([
        sys.executable, str(Path(__file__).with_name("inspect_face_containment.py")),
        str(args.source), str(args.index), *(str(face_id) for face_id in args.face_ids),
    ])
    for face in json.loads(raw):
        outer = next(ring for ring in face["rings"] if ring["outer"])
        points = outer["vertices"]
        normal = [0.0, 0.0, 0.0]
        for a, b in zip(points, points[1:] + points[:1]):
            normal[0] += (a[1] - b[1]) * (a[2] + b[2])
            normal[1] += (a[2] - b[2]) * (a[0] + b[0])
            normal[2] += (a[0] - b[0]) * (a[1] + b[1])
        length = math.sqrt(sum(value * value for value in normal))
        axis = max(range(3), key=lambda coordinate: abs(normal[coordinate]))
        project = lambda vertex: tuple(vertex[coordinate] for coordinate in range(3) if coordinate != axis)
        outer_polygon = Polygon([project(vertex) for vertex in points])
        origin = points[0]
        rings = []
        hole_polygons = []
        for ring in face["rings"]:
            polygon = Polygon([project(vertex) for vertex in ring["vertices"]])
            if not ring["outer"]:
                hole_polygons.append(polygon)
            repaired = make_valid(polygon) if not polygon.is_valid else polygon
            projected = [project(vertex) for vertex in ring["vertices"]]
            minimum_edge = min((math.dist(a, b) for a, b in zip(projected, projected[1:] + projected[:1])),
                               default=0)
            distances = [abs(sum((vertex[i] - origin[i]) * normal[i] for i in range(3))) / length
                         for vertex in ring["vertices"]] if length else []
            rings.append({
                "outer": ring["outer"], "vertices": ring["points"],
                "valid": polygon.is_valid, "area": polygon.area,
                "validityReason": explain_validity(polygon),
                "repairedArea": repaired.area,
                "areaChange": repaired.area - polygon.area,
                "minimumEdge": minimum_edge,
                "maxPlaneDistance": max(distances, default=0),
                "coveredByOuter": None if ring["outer"] else outer_polygon.covers(polygon),
                "touchesOuter": None if ring["outer"] else outer_polygon.boundary.intersects(polygon.boundary),
                "intersectionArea": None if ring["outer"] or not polygon.is_valid
                else outer_polygon.intersection(polygon).area,
            })
        print(json.dumps({"faceId": face["faceId"], "axis": axis,
                          "outerNormalLength": length, "rings": rings,
                          "holePairs": [{"a": i, "b": j,
                                         "intersectionArea": a.intersection(b).area if a.is_valid and b.is_valid else None,
                                         "touch": a.touches(b) if a.is_valid and b.is_valid else None}
                                        for i, a in enumerate(hole_polygons)
                                        for j, b in enumerate(hole_polygons) if j > i]}, ensure_ascii=True))


if __name__ == "__main__":
    main()
