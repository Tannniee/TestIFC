// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Pure geometry predicates and frame transforms for void subtraction.
//! GeometryRouter-free helpers shared by the void orchestrator and probe.

use super::NORMALIZE_EPSILON;
use crate::{Error, Mesh, Point3, Result, Vector3};
use nalgebra::Matrix4;

// The closure / pairing / volume checks live in `mesh_check`; these are the
// names the void path has always called them by.
pub(super) use crate::mesh_check::directed_closed_exact as mesh_is_closed_exact;
pub(super) use crate::mesh_check::undirected_defect_count as topology_defect_count;
pub(crate) use crate::mesh_check::{
    signed_volume as mesh_signed_volume, signed_volume_about as mesh_signed_volume_about,
    volume_reference,
};

/// Extract rotation columns from a 4x4 transform matrix.
pub(crate) fn extract_rotation_columns(m: &Matrix4<f64>) -> (Vector3<f64>, Vector3<f64>, Vector3<f64>) {
    (
        Vector3::new(m[(0, 0)], m[(1, 0)], m[(2, 0)]),
        Vector3::new(m[(0, 1)], m[(1, 1)], m[(2, 1)]),
        Vector3::new(m[(0, 2)], m[(1, 2)], m[(2, 2)]),
    )
}

/// Apply rotation from columns to a direction and normalize.
pub(crate) fn rotate_and_normalize(
    rot: &(Vector3<f64>, Vector3<f64>, Vector3<f64>),
    dir: &Vector3<f64>,
) -> Result<Vector3<f64>> {
    (rot.0 * dir.x + rot.1 * dir.y + rot.2 * dir.z)
        .try_normalize(NORMALIZE_EPSILON)
        .ok_or_else(|| Error::geometry("Zero-length direction vector".to_string()))
}

/// Pick a unit-vector along the wall's thinnest AABB axis. Used as a
/// last-ditch extrusion direction for the issue #635 AABB fallback when
/// the opening doesn't carry an explicit `IfcDirection`.
#[inline]
pub(super) fn wall_thinnest_axis_dir(wall_min: &Point3<f64>, wall_max: &Point3<f64>) -> Vector3<f64> {
    let ext = [
        (wall_max.x - wall_min.x).abs(),
        (wall_max.y - wall_min.y).abs(),
        (wall_max.z - wall_min.z).abs(),
    ];
    let mut axis = 0;
    for i in 1..3 {
        if ext[i] < ext[axis] {
            axis = i;
        }
    }
    match axis {
        0 => Vector3::new(1.0, 0.0, 0.0),
        1 => Vector3::new(0.0, 1.0, 0.0),
        _ => Vector3::new(0.0, 0.0, 1.0),
    }
}

/// Penetration (depth) axis for a box opening that carries no authored
/// extrusion direction. The cut axis is the one the opening pierces
/// transversally: it extends PAST the host on at least one side. A deep
/// FreeCAD-style cutter is far deeper than the wall is thick, so its THINNEST
/// AABB axis is NOT the depth — picking thinnest there points the through-host
/// cap-flush extension along an in-plane axis, where it latches onto a
/// neighbouring void's reveal facet and grows the hole (issue #1337). Falls
/// back to the thinnest axis (the classic flush wall-thickness cutter that sits
/// inside the host on every axis), preserving prior behaviour for those.
pub(super) fn infer_box_penetration_dir(
    open_min: &Point3<f64>,
    open_max: &Point3<f64>,
    host_min: &Point3<f64>,
    host_max: &Point3<f64>,
) -> Vector3<f64> {
    let o = [
        (open_min.x, open_max.x),
        (open_min.y, open_max.y),
        (open_min.z, open_max.z),
    ];
    let h = [
        (host_min.x, host_max.x),
        (host_min.y, host_max.y),
        (host_min.z, host_max.z),
    ];
    let mut best_axis = usize::MAX;
    let mut best_past = 1.0e-6;
    for a in 0..3 {
        // How far the opening pokes past the host on either side along axis `a`.
        let past = (h[a].0 - o[a].0).max(0.0) + (o[a].1 - h[a].1).max(0.0);
        if past > best_past {
            best_past = past;
            best_axis = a;
        }
    }
    match best_axis {
        0 => Vector3::new(1.0, 0.0, 0.0),
        1 => Vector3::new(0.0, 1.0, 0.0),
        2 => Vector3::new(0.0, 0.0, 1.0),
        // Inside the host on every axis ⇒ flush cutter ⇒ classic thinnest-axis.
        _ => wall_thinnest_axis_dir(open_min, open_max),
    }
}

/// World-axis along the opening MESH's THINNEST AABB extent — the depth direction
/// used to extend a cutter through the host when the opening carries no explicit
/// extrusion direction. (A box opening's thinnest axis is its depth.)
pub(super) fn opening_mesh_thinnest_axis_dir(opening_mesh: &Mesh) -> Vector3<f64> {
    let (mn, mx) = opening_mesh.bounds();
    wall_thinnest_axis_dir(
        &Point3::new(mn.x as f64, mn.y as f64, mn.z as f64),
        &Point3::new(mx.x as f64, mx.y as f64, mx.z as f64),
    )
}

/// Count the disjoint spatial clusters formed by a set of per-item void AABBs.
///
/// Two AABBs join the same cluster when they overlap or touch on every axis
/// (within `TOUCH_EPS`, so adjacent wall-leaf halves of one window count as one
/// cluster); AABBs separated by a real gap on any axis stay in different
/// clusters. Used by `program::openings::classify` to tell a row of SEPARATE window voids
/// (many clusters → subtract per item) from one void split into touching parts
/// (one cluster → keep merged). See the call site for the #1367 / FZK-Haus
/// rationale. O(n²) union-find; `n` is the void-body count of a single opening
/// (tiny in practice).
pub(crate) fn spatial_cluster_count(
    bounds: &[(Point3<f64>, Point3<f64>, Option<Vector3<f64>>)],
) -> usize {
    const TOUCH_EPS: f64 = 1.0e-3; // 1 mm: adjacent faces count as connected
    let n = bounds.len();
    if n <= 1 {
        return n;
    }
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut [usize], x: usize) -> usize {
        let mut r = x;
        while p[r] != r {
            r = p[r];
        }
        let mut c = x;
        while p[c] != r {
            let nxt = p[c];
            p[c] = r;
            c = nxt;
        }
        r
    }
    let overlaps = |a: &(Point3<f64>, Point3<f64>, Option<Vector3<f64>>),
                    b: &(Point3<f64>, Point3<f64>, Option<Vector3<f64>>)| {
        a.0.x <= b.1.x + TOUCH_EPS
            && b.0.x <= a.1.x + TOUCH_EPS
            && a.0.y <= b.1.y + TOUCH_EPS
            && b.0.y <= a.1.y + TOUCH_EPS
            && a.0.z <= b.1.z + TOUCH_EPS
            && b.0.z <= a.1.z + TOUCH_EPS
    };
    for i in 0..n {
        for j in (i + 1)..n {
            if overlaps(&bounds[i], &bounds[j]) {
                let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                parent[ri] = rj;
            }
        }
    }
    (0..n).filter(|&i| find(&mut parent, i) == i).count()
}

/// Whether `dir` is (essentially) parallel to a world axis.
///
/// This gates the opening-classification fork: an opening only takes the fast
/// world-axis-aligned-AABB `Rectangular` cut path when its extrusion direction
/// AND its inferred frame are axis-aligned; otherwise it is cut as its true
/// oriented box (`DiagonalRectangular` / exact mesh). The AABB of a *rotated*
/// opening box is strictly larger than the box itself, so cutting the AABB
/// removes wall material outside the real opening — leaving a hole that is
/// bigger than the window and skewed to the world grid instead of orthogonal
/// to the wall.
///
/// The tolerance must therefore be TIGHT. The previous value (0.95, ≈ 18°) let
/// a wall rotated in plan by up to ~18° — a façade a few degrees off the
/// project grid, or an entire building rotated relative to the world axes —
/// fall onto the AABB path and over-cut its openings by tens of centimetres
/// (issue #1167, "weird wall hole cutting"). `cos(1°)` keeps genuinely
/// axis-aligned walls — whose direction cosines are exact up to f32 mesh-normal
/// noise (~1e-6 ≈ 0.0001°) — on the fast path with a ~1000× margin, while
/// routing anything rotated by ≥ 1° to the exact oriented cut. At 1° the
/// residual AABB over-cut would be sub-millimetre anyway.
#[inline]
pub(crate) fn is_axis_aligned_direction(dir: &Vector3<f64>) -> bool {
    // cos(1°). Deliberately tight — see the doc comment (issue #1167).
    const AXIS_THRESHOLD: f64 = 0.999_847_695;
    dir.x.abs().max(dir.y.abs()).max(dir.z.abs()) > AXIS_THRESHOLD
}

#[inline]
pub(super) fn mesh_point(mesh: &Mesh, index: u32) -> Option<Point3<f64>> {
    let base = index as usize * 3;
    Some(Point3::new(
        *mesh.positions.get(base)? as f64,
        *mesh.positions.get(base + 1)? as f64,
        *mesh.positions.get(base + 2)? as f64,
    ))
}

pub(super) fn extent_along_axis(mesh: &Mesh, axis: &Vector3<f64>) -> Option<f64> {
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for chunk in mesh.positions.chunks_exact(3) {
        let p = Vector3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
        let projection = p.dot(axis);
        min = min.min(projection);
        max = max.max(projection);
    }
    min.is_finite().then_some(max - min)
}

<<<<<<< custom-r7
/// Whether a mesh is a clean axis-aligned (in its own frame) rectangular box —
/// i.e. exactly 6 planar faces forming a bounding parallelepiped. Curved or
/// arched openings produce many distinct triangle normals; rectilinear but
/// non-rectangular openings (e.g. an L-shaped shaft) share the same three axes
/// as a box but split their faces across more than two parallel planes per
/// axis. Both cases must go through full CSG rather than the AABB cutters.
///
/// Matches the anti-parallel merge tolerance used by `infer_opening_frame` so
/// the two helpers agree on what counts as a single axis.
pub(super) use super::box_proof::is_rectangular_box_mesh;

pub(super) fn infer_opening_frame(mesh: &Mesh, extrusion_dir: Option<&Vector3<f64>>) -> Option<OpeningFrame> {
    let mut axes: Vec<(Vector3<f64>, f64)> = Vec::new();

    for tri in mesh.indices.chunks_exact(3) {
        let (Some(p0), Some(p1), Some(p2)) = (
            mesh_point(mesh, tri[0]),
            mesh_point(mesh, tri[1]),
            mesh_point(mesh, tri[2]),
        ) else {
            continue;
        };
        let normal_raw = (p1 - p0).cross(&(p2 - p0));
        let weight = normal_raw.norm();
        let Some(mut normal) = normal_raw.try_normalize(NORMALIZE_EPSILON) else {
            continue;
        };

        if let Some((axis, axis_weight)) = axes
            .iter_mut()
            .find(|(axis, _)| normal.dot(axis).abs() > 0.98)
        {
            if normal.dot(axis) < 0.0 {
                normal = -normal;
            }
            if let Some(merged) =
                (*axis * *axis_weight + normal * weight).try_normalize(NORMALIZE_EPSILON)
            {
                *axis = merged;
                *axis_weight += weight;
            }
        } else {
            axes.push((normal, weight));
        }
    }

    if axes.len() < 3 {
        return extrusion_dir.and_then(|dir| OpeningFrame::from_depth(*dir));
    }

    let depth_index =
        if let Some(dir) = extrusion_dir.and_then(|d| d.try_normalize(NORMALIZE_EPSILON)) {
            axes.iter()
                .enumerate()
                .max_by(|(_, (a, _)), (_, (b, _))| a.dot(&dir).abs().total_cmp(&b.dot(&dir).abs()))
                .map(|(index, _)| index)?
        } else {
            axes.iter()
                .enumerate()
                .filter_map(|(index, (axis, _))| extent_along_axis(mesh, axis).map(|e| (index, e)))
                .min_by(|(_, a), (_, b)| a.total_cmp(b))
                .map(|(index, _)| index)?
        };

    let mut depth = axes[depth_index].0;
    if let Some(dir) = extrusion_dir {
        if depth.dot(dir) < 0.0 {
            depth = -depth;
        }
    }

    let mut cross_candidates: Vec<Vector3<f64>> = axes
        .iter()
        .enumerate()
        .filter_map(|(index, (axis, _))| {
            (index != depth_index && axis.dot(&depth).abs() < 0.25).then_some(*axis)
        })
        .collect();

    if cross_candidates.len() < 2 {
        let mut frame = OpeningFrame::from_depth(depth)?;
        frame.depth_is_authored = extrusion_dir.is_some();
        return Some(frame);
    }

    let mut cross_a = cross_candidates.remove(0);
    cross_a = (cross_a - depth * cross_a.dot(&depth)).try_normalize(NORMALIZE_EPSILON)?;
    let mut cross_b = depth.cross(&cross_a).try_normalize(NORMALIZE_EPSILON)?;
    if cross_b.dot(&cross_candidates[0]) < 0.0 {
        cross_b = -cross_b;
    }

    Some(OpeningFrame {
        depth,
        cross_a,
        cross_b,
        depth_is_authored: extrusion_dir.is_some(),
    })
}
||||||| previous-upstream
/// Whether a mesh is a clean axis-aligned (in its own frame) rectangular box —
/// i.e. exactly 6 planar faces forming a bounding parallelepiped. Curved or
/// arched openings produce many distinct triangle normals; rectilinear but
/// non-rectangular openings (e.g. an L-shaped shaft) share the same three axes
/// as a box but split their faces across more than two parallel planes per
/// axis. Both cases must go through full CSG rather than the AABB cutters.
///
/// Matches the anti-parallel merge tolerance used by `infer_opening_frame` so
/// the two helpers agree on what counts as a single axis.
pub(super) fn is_rectangular_box_mesh(mesh: &Mesh) -> bool {
    let mut axes: Vec<Vector3<f64>> = Vec::with_capacity(4);
    let mut tri_axes: Vec<(usize, f64)> = Vec::with_capacity(mesh.indices.len() / 3);
    for tri in mesh.indices.chunks_exact(3) {
        let (Some(p0), Some(p1), Some(p2)) = (
            mesh_point(mesh, tri[0]),
            mesh_point(mesh, tri[1]),
            mesh_point(mesh, tri[2]),
        ) else {
            continue;
        };
        let Some(normal) = (p1 - p0).cross(&(p2 - p0)).try_normalize(NORMALIZE_EPSILON) else {
            continue;
        };
        let axis_index = match axes
            .iter()
            .position(|axis| normal.dot(axis).abs() > 0.98)
        {
            Some(idx) => idx,
            None => {
                if axes.len() >= 3 {
                    return false;
                }
                axes.push(normal);
                axes.len() - 1
            }
        };
        // Signed offset along the merged axis. The merged axis direction is
        // the first normal seen for that group, so opposite faces produce
        // offsets of opposite sign.
        let offset = p0.coords.dot(&axes[axis_index]);
        tri_axes.push((axis_index, offset));
    }
    if axes.len() != 3 {
        return false;
    }

    // The 3 distinct face normals must be mutually orthogonal — otherwise a
    // shape like a trapezoid extrusion (front/back + top/bottom + two slanted
    // sides whose normals are anti-parallel and merge into one axis) would
    // pass with 3 "axes" but not actually be a box. A trapezoid's slanted
    // axis is not perpendicular to the top/bottom axis. Tolerance 0.02 rad
    // matches the 0.98 dot tolerance used above for anti-parallel merging.
    const ORTHOGONAL_DOT_TOL: f64 = 0.02;
    for i in 0..3 {
        for j in (i + 1)..3 {
            if axes[i].dot(&axes[j]).abs() > ORTHOGONAL_DOT_TOL {
                return false;
            }
        }
    }

    // For each axis, the triangle offsets must cluster around exactly 2 values
    // (the two opposite faces of the box). More than 2 distinct planes means
    // the footprint is rectilinear-but-not-rectangular (e.g. an L-shape).
    // Tolerance is 1mm absolute — coarser than float precision but tight
    // enough to distinguish wall positions in any realistic IFC unit.
    const PLANE_TOL: f64 = 1e-3;
    for axis_index in 0..3 {
        let mut planes: Vec<f64> = Vec::with_capacity(3);
        for (idx, offset) in &tri_axes {
            if *idx != axis_index {
                continue;
            }
            if !planes.iter().any(|p| (p - offset).abs() < PLANE_TOL) {
                planes.push(*offset);
                if planes.len() > 2 {
                    return false;
                }
            }
        }
        if planes.len() != 2 {
            return false;
        }
    }
    true
}

pub(super) fn infer_opening_frame(mesh: &Mesh, extrusion_dir: Option<&Vector3<f64>>) -> Option<OpeningFrame> {
    let mut axes: Vec<(Vector3<f64>, f64)> = Vec::new();

    for tri in mesh.indices.chunks_exact(3) {
        let (Some(p0), Some(p1), Some(p2)) = (
            mesh_point(mesh, tri[0]),
            mesh_point(mesh, tri[1]),
            mesh_point(mesh, tri[2]),
        ) else {
            continue;
        };
        let normal_raw = (p1 - p0).cross(&(p2 - p0));
        let weight = normal_raw.norm();
        let Some(mut normal) = normal_raw.try_normalize(NORMALIZE_EPSILON) else {
            continue;
        };

        if let Some((axis, axis_weight)) = axes
            .iter_mut()
            .find(|(axis, _)| normal.dot(axis).abs() > 0.98)
        {
            if normal.dot(axis) < 0.0 {
                normal = -normal;
            }
            if let Some(merged) =
                (*axis * *axis_weight + normal * weight).try_normalize(NORMALIZE_EPSILON)
            {
                *axis = merged;
                *axis_weight += weight;
            }
        } else {
            axes.push((normal, weight));
        }
    }

    if axes.len() < 3 {
        return extrusion_dir.and_then(|dir| OpeningFrame::from_depth(*dir));
    }

    let depth_index =
        if let Some(dir) = extrusion_dir.and_then(|d| d.try_normalize(NORMALIZE_EPSILON)) {
            axes.iter()
                .enumerate()
                .max_by(|(_, (a, _)), (_, (b, _))| a.dot(&dir).abs().total_cmp(&b.dot(&dir).abs()))
                .map(|(index, _)| index)?
        } else {
            axes.iter()
                .enumerate()
                .filter_map(|(index, (axis, _))| extent_along_axis(mesh, axis).map(|e| (index, e)))
                .min_by(|(_, a), (_, b)| a.total_cmp(b))
                .map(|(index, _)| index)?
        };

    let mut depth = axes[depth_index].0;
    if let Some(dir) = extrusion_dir {
        if depth.dot(dir) < 0.0 {
            depth = -depth;
        }
    }

    let mut cross_candidates: Vec<Vector3<f64>> = axes
        .iter()
        .enumerate()
        .filter_map(|(index, (axis, _))| {
            (index != depth_index && axis.dot(&depth).abs() < 0.25).then_some(*axis)
        })
        .collect();

    if cross_candidates.len() < 2 {
        let mut frame = OpeningFrame::from_depth(depth)?;
        frame.depth_is_authored = extrusion_dir.is_some();
        return Some(frame);
    }

    let mut cross_a = cross_candidates.remove(0);
    cross_a = (cross_a - depth * cross_a.dot(&depth)).try_normalize(NORMALIZE_EPSILON)?;
    let mut cross_b = depth.cross(&cross_a).try_normalize(NORMALIZE_EPSILON)?;
    if cross_b.dot(&cross_candidates[0]) < 0.0 {
        cross_b = -cross_b;
    }

    Some(OpeningFrame {
        depth,
        cross_a,
        cross_b,
        depth_is_authored: extrusion_dir.is_some(),
    })
}
=======
pub(crate) use frame_rotate::signed_permutation_map;
pub(super) use frame_rotate::{
    rotate_mesh_from_frame, rotate_mesh_into_frame, rotate_point, thin_axis,
};
pub(crate) use opening_frame::{infer_opening_frame, is_rectangular_box_mesh};
pub(super) use parity::{
    opening_engulfs_host_solid, opening_redundant_with_host, point_inside_mesh,
    point_inside_mesh_agreed,
};
>>>>>>> github-main

#[path = "frame_project.rs"]
mod frame_project;
pub(in crate::router::voids) use frame_project::{
    mesh_to_frame, project_aabb_in_frame, wall_frame_from_depth,
};

#[path = "frame_rotate.rs"]
mod frame_rotate;
#[path = "opening_frame.rs"]
pub(super) mod opening_frame;
#[path = "parity.rs"]
pub(super) mod parity;
