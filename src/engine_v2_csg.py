"""Build source-bound CSG meshes for the Engine V2 native artifact worker."""

from __future__ import annotations

import hashlib
import math
import os
import struct
import threading
import uuid
from pathlib import Path


_MAGIC = b"IFCOVR01"
_MAX_BYTES = 512 * 1024 * 1024
_MAX_MESHES = 50_000


def _hash_file(path: Path, cancelled: threading.Event | None) -> bytes:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            if cancelled is not None and cancelled.is_set():
                raise InterruptedError("cancelled")
            digest.update(chunk)
    return digest.digest()


def _weld_shape(shape: object, express_id: int) -> tuple[list[tuple[float, float, float]], list[int]]:
    geometry = getattr(shape, "geometry", shape)
    raw_vertices = geometry.verts
    raw_faces = geometry.faces
    if len(raw_vertices) % 3 or len(raw_faces) % 3:
        raise ValueError(f"CSG #{express_id} has incomplete geometry")
    if not raw_faces:
        return [], []
    coordinates = [tuple(float(value) for value in raw_vertices[offset:offset + 3])
                   for offset in range(0, len(raw_vertices), 3)]
    if any(not all(math.isfinite(value) for value in point) for point in coordinates):
        raise ValueError(f"CSG #{express_id} has non-finite coordinates")
    span = max(max(point[axis] for point in coordinates) - min(point[axis] for point in coordinates)
               for axis in range(3))
    tolerance = min(max(1e-10, span * 1e-9), 1e-5)
    tolerance_squared = tolerance * tolerance
    cells: dict[tuple[int, int, int], list[int]] = {}
    exact: dict[tuple[float, float, float], int] = {}
    points: list[tuple[float, float, float]] = []
    remap: list[int] = []
    for point in coordinates:
        duplicate = exact.get(point)
        if duplicate is not None:
            remap.append(duplicate)
            continue
        cell = tuple(math.floor(value / tolerance) for value in point)
        found = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for candidate in cells.get((cell[0] + dx, cell[1] + dy, cell[2] + dz), ()):
                        other = points[candidate]
                        if sum((point[axis] - other[axis]) ** 2 for axis in range(3)) <= tolerance_squared:
                            found = candidate
                            break
                    if found is not None:
                        break
                if found is not None:
                    break
            if found is not None:
                break
        if found is None:
            found = len(points)
            points.append(point)
            cells.setdefault(cell, []).append(found)
        exact[point] = found
        remap.append(found)
    if any(index < 0 or index >= len(remap) for index in raw_faces):
        raise ValueError(f"CSG #{express_id} has an out-of-range vertex index")
    faces: list[int] = []
    for offset in range(0, len(raw_faces), 3):
        a, b, c = (remap[int(raw_faces[offset + corner])] for corner in range(3))
        if a != b and b != c and c != a:
            faces.extend((a, b, c))
    if not faces:
        return [], []
    if len(points) > 1_000_000 or len(faces) // 3 > 2_000_000:
        raise ValueError(f"CSG #{express_id} exceeds the per-mesh safety limit")
    return points, faces


def _copy_existing_overrides(destination: Path, stream: object, source_hash: bytes) -> set[int]:
    if not destination.is_file():
        return set()
    copied: set[int] = set()
    with destination.open("rb") as previous:
        header = previous.read(44)
        if len(header) != 44 or header[:8] != _MAGIC or header[8:40] != source_hash:
            return set()
        count = struct.unpack_from("<i", header, 40)[0]
        if count < 0 or count > _MAX_MESHES:
            return set()
        for _ in range(count):
            entry = previous.read(12)
            if len(entry) != 12:
                raise ValueError("Existing geometry override is truncated")
            express_id, vertices, triangles = struct.unpack("<iii", entry)
            byte_count = vertices * 24 + triangles * 12
            if express_id <= 0 or not ((vertices == 0 and triangles == 0) or
                                       (vertices >= 3 and triangles >= 1)) or byte_count > _MAX_BYTES:
                raise ValueError("Existing geometry override has invalid dimensions")
            stream.write(entry)
            while byte_count:
                chunk = previous.read(min(byte_count, 8 * 1024 * 1024))
                if not chunk:
                    raise ValueError("Existing geometry override is truncated")
                stream.write(chunk)
                byte_count -= len(chunk)
            if express_id in copied:
                raise ValueError("Existing geometry override contains duplicate IDs")
            copied.add(express_id)
        if previous.read(1):
            raise ValueError("Existing geometry override has trailing bytes")
    return copied


def write_csg_overrides(source: Path, destination: Path,
                        cancelled: threading.Event | None = None,
                        *, extra_ids: set[int] | None = None,
                        include_boolean: bool = True) -> int:
    import ifcopenshell
    import ifcopenshell.geom

    source = source.resolve(strict=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    model = ifcopenshell.open(str(source))
    settings = ifcopenshell.geom.settings()
    settings.set("convert-back-units", True)
    settings.set("use-world-coords", False)
    items = ({item.id(): item for representation in model.by_type("IfcShapeRepresentation")
              for item in representation.Items if item.is_a("IfcBooleanResult")}
             if include_boolean else {})
    for express_id in extra_ids or ():
        item = model.by_id(express_id)
        if item is None or item.is_a() not in {
            "IfcFacetedBrep", "IfcShellBasedSurfaceModel", "IfcFaceBasedSurfaceModel",
            "IfcTriangulatedFaceSet", "IfcPolygonalFaceSet",
            "IfcExtrudedAreaSolid", "IfcExtrudedAreaSolidTapered",
            "IfcSweptDiskSolid", "IfcSweptDiskSolidPolygonal",
            "IfcRevolvedAreaSolid", "IfcRevolvedAreaSolidTapered",
        }:
            continue
        items[express_id] = item
    if len(items) > _MAX_MESHES:
        raise ValueError("Too many CSG representation items")
    source_hash = _hash_file(source, cancelled)
    partial = destination.with_name(destination.name + "." + uuid.uuid4().hex + ".partial")
    try:
        with partial.open("wb") as stream:
            stream.write(_MAGIC)
            stream.write(source_hash)
            stream.write(struct.pack("<i", 0))
            copied = _copy_existing_overrides(destination, stream, source_hash)
            converted = len(copied)
            for express_id, item in sorted(items.items()):
                if express_id in copied:
                    continue
                if cancelled is not None and cancelled.is_set():
                    raise InterruptedError("cancelled")
                try:
                    points, faces = _weld_shape(ifcopenshell.geom.create_shape(settings, item), express_id)
                except (RuntimeError, ValueError):
                    # The native graph planner still rejects a referenced item
                    # without an override. An unused malformed representation
                    # must not make every other Boolean item unopenable.
                    continue
                # The external kernel may return an empty result or a boundary
                # mesh for malformed Boolean operands. Preserve its actual
                # visible triangles; the native renderer does not invent faces.
                stream.write(struct.pack("<iii", express_id, len(points), len(faces) // 3))
                for point in points:
                    stream.write(struct.pack("<ddd", *point))
                for index in faces:
                    stream.write(struct.pack("<i", index))
                if stream.tell() > _MAX_BYTES:
                    raise ValueError("CSG override file exceeds its safety limit")
                converted += 1
                if converted % 1000 == 0:
                    stream.flush()
            stream.seek(40)
            stream.write(struct.pack("<i", converted))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(partial, destination)
    finally:
        partial.unlink(missing_ok=True)
    return converted
