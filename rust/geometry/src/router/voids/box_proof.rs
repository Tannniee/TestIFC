// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometric proof before replacing a cutter with an orthogonal box.
use super::geom::mesh_point;
use super::NORMALIZE_EPSILON;
use crate::{Mesh,Vector3};

pub(super) fn is_rectangular_box_mesh(mesh: &Mesh) -> bool {
    let mut axes: Vec<Vector3<f64>> = Vec::with_capacity(4);
    const PLANE_TOL: f64 = 1e-3;
    let mut tri_axes: Vec<(usize, f64)> = Vec::with_capacity(mesh.indices.len());
    for tri in mesh.indices.as_chunks::<3>().0 {
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
        // Testing only p0 accepted a wedge whenever the triangulator reused
        // its first corner. Every corner must occupy the SAME support plane.
        let offsets=[p0,p1,p2].map(|p|p.coords.dot(&axes[axis_index]));
        let low=offsets.iter().copied().fold(f64::INFINITY,f64::min);
        let high=offsets.iter().copied().fold(f64::NEG_INFINITY,f64::max);
        if high-low>PLANE_TOL { return false; }
        for offset in offsets { tri_axes.push((axis_index,offset)); }
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


#[cfg(test)]
#[path="box_proof_tests.rs"]
mod tests;
