"""Compare one isolated Engine V2 BRep artifact with IfcOpenShell geometry."""

from __future__ import annotations

import json
import math
import struct
import sys
from collections import Counter
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
from shapely.geometry import Polygon
from shapely.ops import unary_union


source = Path(sys.argv[1])
brep_id = int(sys.argv[2])
chunks = Path(sys.argv[3])
base_id = int(sys.argv[4]) if len(sys.argv) > 4 else brep_id
model = ifcopenshell.open(str(source))
geometry = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), model.by_id(brep_id))
geometry = geometry.geometry if hasattr(geometry, "geometry") else geometry
reference_points = [tuple(geometry.verts[index:index + 3]) for index in range(0, len(geometry.verts), 3)]
reference_triangles = [tuple(reference_points[geometry.faces[index + corner]] for corner in range(3))
                       for index in range(0, len(geometry.faces), 3)]

mesh_bytes = (chunks / "meshes.ifcv2").read_bytes()
mesh = next((offset for offset in range(32, len(mesh_bytes), 56)
             if struct.unpack_from("<i", mesh_bytes, offset)[0] == base_id), None)
if mesh is None:
    raise ValueError(f"Artifact has no mesh for base definition #{base_id}")
first_index, index_count = struct.unpack_from("<qi", mesh_bytes, mesh + 8)
with (chunks / "indices.ifcv2").open("rb") as stream:
    stream.seek(32 + first_index * 4)
    index_bytes = stream.read(index_count * 4)
indices = struct.unpack(f"<{index_count}I", index_bytes)
points = {}
with (chunks / "positions-f64.ifcv2").open("rb") as stream:
    for ordinal in set(indices):
        stream.seek(32 + ordinal * 32 + 8)
        points[ordinal] = struct.unpack("<ddd", stream.read(24))
native_triangles = [tuple(points[indices[index + corner]] for corner in range(3))
                    for index in range(0, len(indices), 3)]


def area(triangle: tuple[tuple[float, float, float], ...]) -> float:
    a, b, c = triangle
    u = tuple(b[axis] - a[axis] for axis in range(3))
    v = tuple(c[axis] - a[axis] for axis in range(3))
    cross = (u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0])
    return math.sqrt(sum(value * value for value in cross)) / 2


def triangle_key(triangle: tuple[tuple[float, float, float], ...]) -> tuple:
    return tuple(sorted(tuple(round(value, 6) for value in point) for point in triangle))


native_keys = Counter(map(triangle_key, native_triangles))
reference_keys = Counter(map(triangle_key, reference_triangles))
native_vertices = {point for triangle in native_triangles for point in triangle}
native_area = sum(map(area, native_triangles))
reference_area = sum(map(area, reference_triangles))


def horizontal_regions(triangles: list[tuple]) -> dict[float, list[Polygon]]:
    groups: dict[float, list[Polygon]] = {}
    for triangle in triangles:
        z_values = [point[2] for point in triangle]
        if max(z_values) - min(z_values) > 1e-7:
            continue
        groups.setdefault(round(sum(z_values) / 3, 6), []).append(
            Polygon([(point[0], point[1]) for point in triangle])
        )
    return groups


native_horizontal = horizontal_regions(native_triangles)
reference_horizontal = horizontal_regions(reference_triangles)
horizontal_comparison = []
for height in sorted(set(native_horizontal) | set(reference_horizontal)):
    native_surface = unary_union(native_horizontal.get(height, []))
    reference_surface = unary_union(reference_horizontal.get(height, []))
    horizontal_comparison.append({
        "z": height,
        "nativeTriangles": len(native_horizontal.get(height, [])),
        "referenceTriangles": len(reference_horizontal.get(height, [])),
        "symmetricDifferenceArea": native_surface.symmetric_difference(reference_surface).area,
    })

print(json.dumps({
    "baseDefinitionId": base_id,
    "nativeTriangles": len(native_triangles),
    "referenceTriangles": len(reference_triangles),
    "nativeUsedVertices": len(native_vertices),
    "referenceVertices": len(reference_points),
    "matchingTriangleCoordinates": sum((native_keys & reference_keys).values()),
    "nativeArea": native_area,
    "referenceArea": reference_area,
    "relativeAreaDifference": abs(native_area - reference_area) / reference_area,
    "nativeBounds": [[min(point[axis] for point in native_vertices),
                      max(point[axis] for point in native_vertices)] for axis in range(3)],
    "referenceBounds": [[min(point[axis] for point in reference_points),
                         max(point[axis] for point in reference_points)] for axis in range(3)],
    "horizontalSurfaces": horizontal_comparison,
}, indent=2))
