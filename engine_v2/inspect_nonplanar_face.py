"""Measure a reported IFC polygonal face's planarity, without modifying the IFC."""

from __future__ import annotations

import argparse
import math

import ifcopenshell
import ifcopenshell.geom


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("face_id", type=int)
    args = parser.parse_args()
    model = ifcopenshell.open(args.source)
    face = model.by_id(args.face_id)
    parents = [item for item in model.get_inverse(face) if item.is_a("IfcPolygonalFaceSet")]
    if not parents:
        raise ValueError("Expected at least one parent face set")
    rings = [face.CoordIndex, *(face.InnerCoordIndices or [])] if face.is_a("IfcIndexedPolygonalFaceWithVoids") else [face.CoordIndex]
    for parent in parents:
        coords = parent.Coordinates.CoordList
        indices = parent.PnIndex
        outer = [coords[(indices[index - 1] if indices else index) - 1] for index in rings[0]]
        normal = [0.0, 0.0, 0.0]
        for a, b in zip(outer, outer[1:] + outer[:1]):
            normal[0] += (a[1] - b[1]) * (a[2] + b[2])
            normal[1] += (a[2] - b[2]) * (a[0] + b[0])
            normal[2] += (a[0] - b[0]) * (a[1] + b[1])
        norm = math.sqrt(sum(value * value for value in normal))
        origin = outer[0]
        points = [coords[(indices[index - 1] if indices else index) - 1] for ring in rings for index in ring]
        deviations = [abs(sum((point[i] - origin[i]) * normal[i] for i in range(3))) / norm for point in points]
        extent = max(math.dist(origin, point) for point in points)
        print(dict(face=face.id(), faceType=face.is_a(), faceSet=parent.id(),
                   ringSizes=[len(ring) for ring in rings], extent=extent,
                   maxDeviation=max(deviations), relativeDeviation=max(deviations) / extent,
                   deviations=sorted(deviations, reverse=True)[:8]))
        try:
            shape = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), parent)
            geometry = getattr(shape, "geometry", shape)
            print(dict(ifcOpenShellVertices=len(geometry.verts) // 3,
                       ifcOpenShellTriangles=len(geometry.faces) // 3))
        except Exception as exc:
            print(f"IfcOpenShell failed: {exc}")


if __name__ == "__main__":
    main()
