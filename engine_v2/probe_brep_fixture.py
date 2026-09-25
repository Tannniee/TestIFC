"""Run IfcOpenShell geometry on one isolated IfcFacetedBrep fixture."""

from __future__ import annotations

import json
import math
import ctypes
import sys
import time

import ifcopenshell
import ifcopenshell.geom


def windows_memory() -> dict[str, int]:
    if sys.platform != "win32":
        return {}

    size_t = ctypes.c_size_t

    class ProcessMemoryCountersEx(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
            (name, size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
                "PrivateUsage",
            )
        ]

    counters = ProcessMemoryCountersEx()
    counters.cb = ctypes.sizeof(counters)
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    ctypes.windll.psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    ctypes.windll.kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    if not ctypes.windll.psapi.GetProcessMemoryInfo(
        ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
    ):
        raise ctypes.WinError()
    return {
        "currentPrivateBytes": counters.PrivateUsage,
        "peakCommitBytes": counters.PeakPagefileUsage,
        "peakWorkingSetBytes": counters.PeakWorkingSetSize,
    }


source = sys.argv[1]
brep_id = int(sys.argv[2])
memory_after_import = windows_memory()
started = time.perf_counter()
model = ifcopenshell.open(source)
open_seconds = time.perf_counter() - started
memory_after_open = windows_memory()
brep = model.by_id(brep_id)
settings = ifcopenshell.geom.settings()
started = time.perf_counter()
result = {"source": source, "brepId": brep_id, "openSeconds": open_seconds}
try:
    shape = ifcopenshell.geom.create_shape(settings, brep)
    geometry = shape.geometry if hasattr(shape, "geometry") else shape
    result["triangleCount"] = len(geometry.faces) // 3
    result["vertexCount"] = len(geometry.verts) // 3
    result["bounds"] = [
        [min(geometry.verts[axis::3]), max(geometry.verts[axis::3])]
        for axis in range(3)
    ]
except Exception as exc:
    result["error"] = f"{type(exc).__name__}: {exc}"
result["geometrySeconds"] = time.perf_counter() - started
memory_after_geometry = windows_memory()
result["faces"] = []
for face_id in (int(value) for value in sys.argv[3:]):
    from shapely.geometry import Point, Polygon

    face_result = {"faceId": face_id}
    try:
        face = model.by_id(face_id)
        outer_bound = next(bound for bound in face.Bounds if bound.is_a("IfcFaceOuterBound"))
        outer = Polygon([point.Coordinates[:2] for point in outer_bound.Bound.Polygon])
        shape = ifcopenshell.geom.create_shape(settings, face)
        geometry = shape.geometry if hasattr(shape, "geometry") else shape
        face_result["triangleCount"] = len(geometry.faces) // 3
        face_result["vertexCount"] = len(geometry.verts) // 3
        face_result["usedVertexCount"] = len(set(geometry.faces))
        area = 0.0
        outside_area = 0.0
        outside_triangles = 0
        for i in range(0, len(geometry.faces), 3):
            a, b, c = (geometry.faces[i + j] * 3 for j in range(3))
            va, vb, vc = (geometry.verts[k:k + 3] for k in (a, b, c))
            ux, uy, uz = (vb[j] - va[j] for j in range(3))
            vx, vy, vz = (vc[j] - va[j] for j in range(3))
            triangle_area = math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 +
                                      (ux * vy - uy * vx) ** 2) / 2
            area += triangle_area
            if not outer.covers(Point(sum(vertex[0] for vertex in (va, vb, vc)) / 3,
                                      sum(vertex[1] for vertex in (va, vb, vc)) / 3)):
                outside_area += triangle_area
                outside_triangles += 1
        face_result["meshArea"] = area
        face_result["outsideOuterArea"] = outside_area
        face_result["outsideOuterTriangles"] = outside_triangles
    except Exception as exc:
        face_result["error"] = f"{type(exc).__name__}: {exc}"
    result["faces"].append(face_result)
result["processMemory"] = {
    "afterImport": memory_after_import,
    "afterOpen": memory_after_open,
    "afterGeometry": memory_after_geometry,
    "afterFaceProbes": windows_memory(),
}
print(json.dumps(result, indent=2), flush=True)
