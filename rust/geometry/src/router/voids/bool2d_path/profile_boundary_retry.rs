// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Precision-bounded regularization against actual polygon boundaries.
//! Only refused all-through planar cuts reach this path. Every moved vertex
//! remains within Precision/4 of its source, toward the solid's exterior.

use super::{movement_envelope, Bool2dCut};
use crate::bool2d::{compute_signed_area, point_in_contour};
use nalgebra::{Point2, Vector2};

pub(super) fn regularize(cut: &Bool2dCut) -> Option<(Vec<Vec<Point2<f64>>>, f64)> {
    let precision = cut.boundary_precision?;
    let grid = crate::kernel::mesh_bridge::SNAP_GRID;
    if !precision.is_finite() || precision * 0.25 < grid * 2.0 { return None; }
    // Sloped exporter edges can leave a rim just beyond one grid. Reserve
    // one grid for outward clearance, keeping the COMPLETE movement inside
    // the source's declared Precision/4 (and at most four grids overall).
    let band = (3.0 * grid).min(precision * 0.25 - grid);
    let rings = std::iter::once(&cut.host_profile.outer).chain(cut.host_profile.holes.iter());
    let mut segments = Vec::new();
    for (ring_index, ring) in rings.enumerate() {
        let area = compute_signed_area(ring);
        if !area.is_finite() || area == 0.0 { return None; }
        let sign = if (area > 0.0) != (ring_index > 0) { 1.0 } else { -1.0 };
        for i in 0..ring.len() {
            let a = ring[i]; let edge = ring[(i + 1) % ring.len()] - a;
            let length = edge.norm();
            if !length.is_finite() { return None; }
            if length > 0.0 { segments.push((a, edge, Vector2::new(edge.y, -edge.x) * (sign / length))); }
        }
    }
    let points = cut.footprints.iter().map(Vec::len).sum::<usize>();
    // Bound file-supplied geometric breadth, independently of reference walks.
    if points.checked_mul(segments.len())? > 1_000_000 { return None; }
    let mut result = cut.footprints.clone();
    for contour in &mut result { for point in contour {
        let original = *point;
        let mut nearest = band * band;
        let mut target = None;
        for (a, edge, normal) in &segments {
            let t = ((original - a).dot(edge) / edge.norm_squared()).clamp(0.0, 1.0);
            let closest = *a + edge * t;
            let distance = (original - closest).norm_squared();
            if distance <= nearest { nearest = distance; target = Some(closest + normal * grid); }
        }
        if let Some(target) = target {
            // At a concave corner the nearest edge's outward normal may enter
            // another material sector. Refuse that case; never guess a side.
            if point_in_contour(&target, &cut.host_profile.outer)
                && cut.host_profile.holes.iter().all(|hole| !point_in_contour(&target, hole)) { return None; }
            if (target - original).norm() > band + grid { return None; }
            *point = target;
        }
    }}
    let envelope = movement_envelope(cut, &result)?;
    Some((result, envelope))
}
