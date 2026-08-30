"""Recover a member centreline from the geometry carried by an IFC product."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Sequence

import ifcopenshell
import numpy as np
from ifcopenshell.util.placement import (
    get_axis2placement,
    get_local_placement,
    get_mappeditem_transformation,
)

_CAP_ALIGNMENT = 0.5
_MIN_FACE_AREA_M2 = 1e-9
_MIN_LENGTH_M = 1e-6
_SAP_LOCAL_AXIS_OFFSET_DEG = 90.0

Point = tuple[float, float, float]


@dataclass(frozen=True)
class MemberAxis:
    """A member centreline in world metres."""

    start: Point
    end: Point
    length_m: float
    direction: Point
    section_normal: Point
    roll_deg: float | None
    route: str
    slenderness: float


@dataclass(frozen=True)
class AxisAbsent:
    """Why a member has no recoverable axis."""

    reason: str
    detail: str


AxisResult = MemberAxis | AxisAbsent


@dataclass(frozen=True)
class _Face:
    points: tuple[Point, ...]
    normal: Point
    area_m2: float
    centroid: Point


def _newell(points: Sequence[Point]) -> tuple[np.ndarray, float]:
    vectors = np.asarray(points, dtype=float)
    rolled = np.roll(vectors, -1, axis=0)
    normal = np.cross(vectors, rolled).sum(axis=0) / 2.0
    magnitude = float(np.linalg.norm(normal))
    if magnitude < _MIN_FACE_AREA_M2:
        return np.zeros(3), 0.0
    return normal / magnitude, magnitude


def _area_centroid(points: Sequence[Point], normal: np.ndarray) -> Point:
    vectors = np.asarray(points, dtype=float)
    origin = vectors[0]
    axis_u = vectors[1] - origin
    axis_u = axis_u / np.linalg.norm(axis_u)
    axis_v = np.cross(normal, axis_u)
    local = np.stack([(vectors - origin) @ axis_u, (vectors - origin) @ axis_v], axis=1)
    x, y = local[:, 0], local[:, 1]
    cross = x * np.roll(y, -1) - np.roll(x, -1) * y
    doubled_area = cross.sum()
    if abs(doubled_area) < _MIN_FACE_AREA_M2:
        return tuple(vectors.mean(axis=0))
    centre_u = float(((x + np.roll(x, -1)) * cross).sum() / (3.0 * doubled_area))
    centre_v = float(((y + np.roll(y, -1)) * cross).sum() / (3.0 * doubled_area))
    return tuple(origin + centre_u * axis_u + centre_v * axis_v)


def _faces_of_shell(shell, transform: np.ndarray, scale: float) -> list[_Face]:
    faces = []
    for face in shell.CfsFaces or ():
        for bound in face.Bounds or ():
            loop = bound.Bound
            if not loop.is_a("IfcPolyLoop") or len(loop.Polygon or ()) < 3:
                continue
            points = _world_points(loop.Polygon, transform, scale)
            normal, area = _newell(points)
            if area < _MIN_FACE_AREA_M2:
                continue
            faces.append(_Face(points, tuple(normal), area, _area_centroid(points, normal)))
    return faces


def _world_points(polygon, transform: np.ndarray, scale: float) -> tuple[Point, ...]:
    local = np.array([[*point.Coordinates, 1.0] for point in polygon], dtype=float)
    world = local @ transform.T
    return tuple(tuple(row[:3] * scale) for row in world)


def _faces_of_item(item, transform: np.ndarray, scale: float) -> list[_Face]:
    if item.is_a("IfcFacetedBrep"):
        return _faces_of_shell(item.Outer, transform, scale)
    if item.is_a("IfcMappedItem"):
        mapped = transform @ get_mappeditem_transformation(item)
        return [
            face
            for source in item.MappingSource.MappedRepresentation.Items or ()
            for face in _faces_of_item(source, mapped, scale)
        ]
    return []


def _axis_from_normals(faces: Sequence[_Face]) -> np.ndarray:
    normals = np.asarray([face.normal for face in faces])
    areas = np.asarray([face.area_m2 for face in faces])
    scatter = (normals * areas[:, None]).T @ normals
    _, vectors = np.linalg.eigh(scatter)
    return vectors[:, 0]


def axis_of_faces(faces: Sequence[_Face]) -> AxisResult:
    if not faces:
        return AxisAbsent("no_faces", "the part carries no planar Brep faces")
    axis = _axis_from_normals(faces)
    points = np.asarray([point for face in faces for point in face.points])
    projected = points @ axis
    extent = float(projected.max() - projected.min())
    if extent < _MIN_LENGTH_M:
        return AxisAbsent(
            "degenerate_extent", f"the solid spans {extent:.6f} m along its own axis"
        )
    caps = [
        face
        for face in faces
        if abs(float(np.asarray(face.normal) @ axis)) >= _CAP_ALIGNMENT
    ]
    if not caps:
        return AxisAbsent(
            "no_end_faces",
            f"no face lies within 60 degrees of square to the axis across {extent:.3f} m",
        )
    return _axis_from_caps(axis, caps, extent)


def _axis_from_caps(axis: np.ndarray, caps: Sequence[_Face], extent: float) -> AxisResult:
    projections = [float(np.asarray(face.centroid) @ axis) for face in caps]
    low, high = min(projections), max(projections)
    if high - low < extent / 2.0:
        return AxisAbsent(
            "one_sided_caps",
            f"cap faces span {high - low:.4f} m of a {extent:.4f} m part",
        )
    near = [
        face
        for face, projection in zip(caps, projections)
        if projection - low <= (high - low) / 2.0
    ]
    far = [
        face
        for face, projection in zip(caps, projections)
        if projection - low > (high - low) / 2.0
    ]
    start, end = _weighted_centroid(near), _weighted_centroid(far)
    vector = np.asarray(end) - np.asarray(start)
    length = float(np.linalg.norm(vector))
    if length < _MIN_LENGTH_M:
        return AxisAbsent("coincident_ends", "both end caps resolve to the same point")
    direction = vector / length
    widest = max(near, key=lambda face: face.area_m2)
    breadth = _section_breadth(widest, direction)
    return MemberAxis(
        start,
        end,
        length,
        tuple(direction),
        tuple(axis),
        _roll_degrees(widest, direction),
        "brep_end_caps",
        length / breadth if breadth > _MIN_LENGTH_M else float("inf"),
    )


def _section_breadth(cap: _Face, direction: np.ndarray) -> float:
    points = np.asarray(cap.points)
    across = points - np.outer(points @ direction, direction)
    spans = across.max(axis=0) - across.min(axis=0)
    return float(np.linalg.norm(spans))


def _roll_degrees(cap: _Face, direction: np.ndarray) -> float | None:
    reference = np.array([0.0, 0.0, 1.0]) - direction * float(
        direction @ np.array([0.0, 0.0, 1.0])
    )
    if float(np.linalg.norm(reference)) < 0.0175:
        reference = np.array([1.0, 0.0, 0.0]) - direction * float(
            direction @ np.array([1.0, 0.0, 0.0])
        )
    reference = reference / np.linalg.norm(reference)
    strong = _strong_axis(cap, direction, reference)
    if strong is None:
        return None
    return _fold_half_turn(
        np.degrees(
            np.arctan2(
                float(np.cross(reference, strong) @ direction),
                float(reference @ strong),
            )
        )
        - _SAP_LOCAL_AXIS_OFFSET_DEG
    )


def _fold_half_turn(angle: float) -> float:
    folded = round(float(angle), 3) % 180.0
    return folded - 180.0 if folded > 90.0 else folded


def _strong_axis(
    cap: _Face, direction: np.ndarray, reference: np.ndarray
) -> np.ndarray | None:
    other = np.cross(direction, reference)
    points = np.asarray(cap.points) - np.asarray(cap.centroid)
    u, v = points @ reference, points @ other
    cross = u * np.roll(v, -1) - np.roll(u, -1) * v
    i_uu = float(
        (cross * (v**2 + v * np.roll(v, -1) + np.roll(v, -1) ** 2)).sum()
        / 12.0
    )
    i_vv = float(
        (cross * (u**2 + u * np.roll(u, -1) + np.roll(u, -1) ** 2)).sum()
        / 12.0
    )
    i_uv = float(
        (
            cross
            * (
                2 * u * v
                + u * np.roll(v, -1)
                + np.roll(u, -1) * v
                + 2 * np.roll(u, -1) * np.roll(v, -1)
            )
        ).sum()
        / 24.0
    )
    largest = max(abs(i_uu), abs(i_vv))
    if largest < _MIN_FACE_AREA_M2:
        return None
    if abs(i_uu - i_vv) < 0.001 * largest and abs(i_uv) < 0.001 * largest:
        return None
    theta = 0.5 * np.arctan2(2.0 * i_uv, i_uu - i_vv)
    return np.cos(theta) * reference + np.sin(theta) * other


def _weighted_centroid(faces: Sequence[_Face]) -> Point:
    areas = np.asarray([face.area_m2 for face in faces])
    centroids = np.asarray([face.centroid for face in faces])
    return tuple((centroids * areas[:, None]).sum(axis=0) / areas.sum())


def _shapes(representation, identifier: str):
    return [
        shape
        for shape in representation.Representations or ()
        if shape.RepresentationIdentifier == identifier
    ]


def _from_axis_curve(representation, placement: np.ndarray, scale: float) -> MemberAxis | None:
    for shape in _shapes(representation, "Axis"):
        for item in shape.Items or ():
            if not item.is_a("IfcPolyline") or len(item.Points or ()) != 2:
                continue
            start, end = _world_points(item.Points, placement, scale)
            vector = np.asarray(end) - np.asarray(start)
            length = float(np.linalg.norm(vector))
            if length < _MIN_LENGTH_M:
                continue
            return MemberAxis(
                start,
                end,
                length,
                tuple(vector / length),
                tuple(vector / length),
                None,
                "axis_curve",
                float("inf"),
            )
    return None


def _from_extrusion(representation, placement: np.ndarray, scale: float) -> MemberAxis | None:
    for shape in _shapes(representation, "Body"):
        for item in shape.Items or ():
            if not item.is_a("IfcExtrudedAreaSolid"):
                continue
            local = placement @ get_axis2placement(item.Position)
            start = tuple(np.asarray(local[:3, 3]) * scale)
            direction = np.asarray(item.ExtrudedDirection.DirectionRatios, dtype=float)
            direction = local[:3, :3] @ (direction / np.linalg.norm(direction))
            length = float(item.Depth) * scale
            if length < _MIN_LENGTH_M:
                continue
            end = tuple(np.asarray(start) + direction * length)
            breadth = _profile_breadth(item.SweptArea) * scale
            return MemberAxis(
                start,
                end,
                length,
                tuple(direction),
                tuple(direction),
                _roll_from_placement(local, direction),
                "extruded_solid",
                length / breadth if breadth > _MIN_LENGTH_M else float("inf"),
            )
    return None


def _roll_from_placement(local: np.ndarray, direction: np.ndarray) -> float:
    profile_x = local[:3, 0] / np.linalg.norm(local[:3, 0])
    reference = np.array([0.0, 0.0, 1.0]) - direction * float(
        direction @ np.array([0.0, 0.0, 1.0])
    )
    if float(np.linalg.norm(reference)) < 0.0175:
        reference = np.array([1.0, 0.0, 0.0]) - direction * float(
            direction @ np.array([1.0, 0.0, 0.0])
        )
    reference = reference / np.linalg.norm(reference)
    return _fold_half_turn(
        np.degrees(
            np.arctan2(
                float(np.cross(reference, profile_x) @ direction),
                float(reference @ profile_x),
            )
        )
        - _SAP_LOCAL_AXIS_OFFSET_DEG
    )


def tapered_profiles(product, length_scale: float) -> tuple[Point, str, str] | None:
    representation = getattr(product, "Representation", None)
    if representation is None:
        return None
    placement_of = getattr(product, "ObjectPlacement", None)
    placement = get_local_placement(placement_of) if placement_of else np.eye(4)
    for shape in representation.Representations or ():
        for item in shape.Items or ():
            if not item.is_a("IfcExtrudedAreaSolid"):
                continue
            local = placement @ get_axis2placement(item.Position)
            start = tuple(np.asarray(local[:3, 3]) * length_scale)
            first = str(getattr(item.SweptArea, "ProfileName", "") or "")
            last = getattr(item, "EndSweptArea", None)
            return (
                start,
                first,
                str(getattr(last, "ProfileName", "") or "") if last is not None else first,
            )
    return None


def _profile_breadth(profile) -> float:
    named = [
        getattr(profile, attribute, None)
        for attribute in ("OverallWidth", "OverallDepth", "XDim", "YDim", "Radius")
    ]
    sizes = [float(value) for value in named if value is not None]
    return max(sizes) if sizes else 0.0


def member_axis(product, length_scale: float) -> AxisResult:
    representation = getattr(product, "Representation", None)
    if representation is None:
        return AxisAbsent(
            "no_representation", "the product carries no shape representation"
        )
    placement = (
        get_local_placement(product.ObjectPlacement)
        if product.ObjectPlacement
        else np.eye(4)
    )
    stated = _from_axis_curve(representation, placement, length_scale)
    swept = _from_extrusion(representation, placement, length_scale)
    if stated is not None:
        if swept is None:
            return stated
        return replace(stated, roll_deg=swept.roll_deg, slenderness=swept.slenderness)
    if swept is not None:
        return swept
    faces = [
        face
        for shape in representation.Representations or ()
        for item in shape.Items or ()
        for face in _faces_of_item(item, placement, length_scale)
    ]
    return axis_of_faces(faces)
