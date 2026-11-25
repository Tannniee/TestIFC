// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Finished planar subtraction for single arbitrary extrusions whose cutters
//! all cross the same plane, including boundary notches and disconnected parts.
//! The established interior-prefix/residual route stays authoritative whenever
//! any cutter is blind, oblique, annular, or otherwise ineligible.

use super::{Bool2dCut, GeometryRouter};
use super::thin_box::{retry, thin_footprint,thin_footprint_impl};
use crate::profile::Profile2D;
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
use nalgebra::{Matrix3, Point2};

impl GeometryRouter {
    pub(super) fn capture_common_plane_cut(
        &self, element: &DecodedEntity, ids: &[u32], decoder: &mut EntityDecoder,
    ) -> Option<Bool2dCut> {
        let source = self.host_extruded_solid(element, decoder)?;
        let scale = self.unit_scale;
        if !scale.is_finite() || scale <= 0.0 || !source.m.iter().all(|x| x.is_finite())
            || !source.depth.is_finite() || source.depth <= 0.0 { return None; }
        let r = source.m.fixed_view::<3, 3>(0, 0).into_owned();
        // Metric boundary distances require an orthonormal plane. Mapped scale
        // or shear defers to the established path rather than guessing a metric.
        if (r.transpose() * r - Matrix3::identity()).amax() > 1e-9 { return None; }
        let mut profile = source.profile;
        if profile.outer.len() < 3 || profile.holes.iter().any(|h| h.len() < 3)
            || profile.outer.iter().chain(profile.holes.iter().flatten())
                .any(|p| !p.x.is_finite() || !p.y.is_finite()) { return None; }
        let mut lo = Point2::new(f64::INFINITY, f64::INFINITY);
        let mut hi = Point2::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in &profile.outer { for i in 0..2 { lo[i] = lo[i].min(p[i] * scale); hi[i] = hi[i].max(p[i] * scale); } }
        let center = (lo.coords + hi.coords) * 0.5;
        for p in profile.outer.iter_mut().chain(profile.holes.iter_mut().flatten()) {
            *p = Point2::from(p.coords * scale - center);
        }
        let depth = source.depth * scale;
        let mut wt = source.m;
        for i in 0..3 {
            wt[(i, 3)] *= scale;
            wt[(i, 3)] -= [self.rtc_offset.0, self.rtc_offset.1, self.rtc_offset.2][i];
            wt[(i, 3)] += r[(i, 0)] * center.x + r[(i, 1)] * center.y;
            if source.dir_sign < 0.0 { wt[(i, 3)] -= r[(i, 2)] * depth; }
        }
        if !wt.iter().all(|x| x.is_finite()) || !depth.is_finite() { return None; }
        let inv = wt.try_inverse()?;
        let mut footprints = Vec::new();
        let mut residual_ids=Vec::new();
        for &id in ids {
            let opening = decoder.decode_by_id(id).ok()?;
            if !opening.ifc_type.is_subtype_of(IfcType::IfcFeatureElementSubtraction) { return None; }
            let tentative=self.opening_extruded_solids(&opening,decoder).and_then(|solids|
                solids.iter().map(|solid|if self.precision_frame.is_some(){thin_footprint_impl(solid,&inv,depth,scale,self.rtc_offset,true)}else{
                    thin_footprint(solid,&inv,depth,scale,self.rtc_offset)
                }).collect::<Option<Vec<_>>>());
            if let Some(mut eligible)=tentative{footprints.append(&mut eligible);}
            else if self.precision_frame.is_some(){residual_ids.push(id);}
            else{return None;}
        }
        if footprints.is_empty() { return None; }
        let residual=if residual_ids.is_empty(){None}else{
            let openings=self.classify_openings_quiet(element,&residual_ids,decoder);
            if openings.is_empty(){return None;}
            Some(Box::new(super::super::VoidContext{merged_openings:openings.clone(),openings,param:None,bool2d:None}))
        };
        Some(Bool2dCut { all_components: true, rectangular_boundary: false,
            common_fallback: None,
            boundary_precision: retry::context_precision(element, decoder, scale),
            host_profile: Profile2D { outer: profile.outer, holes: profile.holes },
            depth, dir_sign: 1.0, wt, footprints, residual })
    }
}

#[cfg(test)]
#[path = "common_plane_tests.rs"]
mod tests;
