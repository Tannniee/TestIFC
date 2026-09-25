"""Summarize rounded/nonplanar face coordinates reported by the native gate."""

from __future__ import annotations

import argparse
import json
import math
import re

import ifcopenshell


def measure(parent, face) -> tuple[float, float]:
    coords = parent.Coordinates.CoordList
    point_map = parent.PnIndex

    def point(index: int):
        return coords[(point_map[index - 1] if point_map else index) - 1]

    rings = [face.CoordIndex]
    if face.is_a("IfcIndexedPolygonalFaceWithVoids"):
        rings += list(face.InnerCoordIndices)
    outer = [point(index) for index in rings[0]]
    normal = [0.0, 0.0, 0.0]
    for a, b in zip(outer, outer[1:] + outer[:1]):
        normal[0] += (a[1] - b[1]) * (a[2] + b[2])
        normal[1] += (a[2] - b[2]) * (a[0] + b[0])
        normal[2] += (a[0] - b[0]) * (a[1] + b[1])
    length = math.sqrt(sum(value * value for value in normal))
    origin = outer[0]
    points = [point(index) for ring in rings for index in ring]
    extent = max(math.dist(origin, vertex) for vertex in points)
    deviation = max(abs(sum((vertex[i] - origin[i]) * normal[i] for i in range(3))) / length
                    for vertex in points)
    return deviation, deviation / extent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("manifest")
    args = parser.parse_args()
    model = ifcopenshell.open(args.source)
    manifest = json.load(open(args.manifest, encoding="utf-8"))
    issues = manifest["coverage"]["graph"]["geometryPlan"]["issues"]
    face_ids = {int(match.group(1)) for issue in issues
                if (match := re.match(r"Indexed polygonal face #(\d+) is not planar", issue))}
    result = []
    for face_id in face_ids:
        face = model.by_id(face_id)
        for parent in model.get_inverse(face):
            if not parent.is_a("IfcPolygonalFaceSet"):
                continue
            deviation, relative = measure(parent, face)
            result.append(dict(face=face_id, faceSet=parent.id(),
                               deviation=deviation, relative=relative))
    result.sort(key=lambda item: item["relative"], reverse=True)
    print(json.dumps(dict(count=len(result), maximum=result[:20], minimum=result[-5:]), indent=2))


if __name__ == "__main__":
    main()
