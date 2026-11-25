// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Bounded planar regularization of tolerance-coincident box boundary cuts.
//! Nanometre rims can pinch in f32, defeat CDT, and open during canonical
//! 15.3 um triangle hygiene. The source's declared Precision must admit every
//! movement; blind/oblique cuts never reach this all-through box route.

use super::super::Bool2dCut;
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
use nalgebra::Point2;
use rustc_hash::FxHashSet;

#[path = "profile_boundary_retry.rs"]
mod profile_boundary;

/// Read only the host's actual Body contexts, never the decoder-wide lazy
/// Precision scan (native decoders are per job, so that would scan the entire
/// model repeatedly). Both representation breadth and parent chains are bound.
pub(in crate::router::voids) fn context_precision(
    element: &DecodedEntity, decoder: &mut EntityDecoder, scale: f64,
) -> Option<f64> {
    let pds = decoder.decode_by_id(element.get_ref(6)?).ok()?;
    if pds.ifc_type != IfcType::IfcProductDefinitionShape { return None; }
    let values = pds.get_list(2)?;
    if values.is_empty() || values.len() > 64 { return None; }
    let mut reps = Vec::new();
    for value in values { reps.push(decoder.decode_by_id(value.as_entity_ref()?).ok()?); }
    let mut minimum = f64::INFINITY;
    let mut work = 0;
    for rep in crate::router::meshed_representations(element, &reps) {
        let Some(kind) = crate::router::effective_element_rep_type(element, rep) else { continue; };
        if !crate::router::is_body_representation(kind) { continue; }
        let mut id = rep.get_ref(0)?;
        let mut visited = FxHashSet::default();
        let precision = loop {
            work += 1;
            if work > 128 || visited.len() >= 16 || !visited.insert(id) { return None; }
            let context = decoder.decode_by_id(id).ok()?;
            match context.ifc_type {
                IfcType::IfcGeometricRepresentationSubContext => id = context.get_ref(6)?,
                IfcType::IfcGeometricRepresentationContext => break context.get_float(3)?,
                _ => return None,
            }
        };
        if !precision.is_finite() || precision <= 0.0 { return None; }
        minimum = minimum.min(precision * scale);
    }
    (minimum.is_finite() && minimum > 0.0).then_some(minimum)
}

/// Move only footprint coordinates within one kernel grid of the exact box
/// edge outward by one grid. Every displacement is at most two grids, AND
/// at most Precision/4. Larger real bridges and strict exports are untouched.
pub(in crate::router::voids::bool2d_path) fn regularize(cut: &Bool2dCut) -> Option<(Vec<Vec<Point2<f64>>>, f64)> {
    if !cut.rectangular_boundary { return profile_boundary::regularize(cut); }
    let precision = cut.boundary_precision?;
    let grid = crate::kernel::mesh_bridge::SNAP_GRID;
    if !precision.is_finite() || precision * 0.25 < grid * 2.0 { return None; }
    let half = cut.host_profile.outer.get(2)?;
    if half.iter().any(|h| !h.is_finite() || *h <= 2.0 * grid) { return None; }
    let mut result = cut.footprints.clone();
    for (source, contour) in cut.footprints.iter().zip(&mut result) {
        for (i, point) in contour.iter_mut().enumerate() {
            for axis in 0..2 {
                for sign in [-1.0, 1.0] {
                    let boundary = sign * half[axis];
                    if (point[axis] - boundary).abs() <= grid {
                        point[axis] = boundary + sign * grid;
                    }
                }
            }
            if (*point - source[i]).norm() > precision * 0.25 { return None; }
        }
    }
    let envelope = movement_envelope(cut, &result)?;
    Some((result, envelope))
}

fn movement_envelope(cut: &Bool2dCut, result: &[Vec<Point2<f64>>]) -> Option<f64> {
    let precision = cut.boundary_precision?;
    let mut maximum = 0.0_f64;
    let mut perimeter = 0.0;
    let mut vertices = 0;
    for (source, contour) in cut.footprints.iter().zip(result) {
        for (i, point) in contour.iter().enumerate() {
            perimeter += (source[i] - source[(i + 1) % source.len()]).norm();
            vertices += 1;
            let distance = (*point - source[i]).norm();
            if !distance.is_finite() || distance > precision * 0.25 { return None; }
            maximum = maximum.max(distance);
        }
    }
    if maximum == 0.0 || !maximum.is_finite() || !perimeter.is_finite() { return None; }
    // Symmetric-difference area is contained in the swept edge strips plus
    // endpoint disks. This conservative envelope also covers overlapping cuts.
    let envelope = 2.0 * perimeter * maximum
        + vertices as f64 * std::f64::consts::PI * maximum * maximum;
    envelope.is_finite().then_some(envelope)
}

pub(in crate::router::voids::bool2d_path) use super::super::super::precision_seams::closed_manifold;
