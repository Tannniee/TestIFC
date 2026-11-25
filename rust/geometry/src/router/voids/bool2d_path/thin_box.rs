// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A clean box may be authored along its length while its voids cross its
//! thickness (Nhip chinh Body #2444). Prove the box, cyclically reorient it,
//! and subtract every through-cutter in its thin-axis plane. This separate
//! all-or-nothing route does not relax the arbitrary-host interiority gates.

use super::super::geom::{mesh_signed_volume, param_cut_watertight};
use super::super::probe::ExtrudedSolidInfo;
use super::super::RectParam;
use super::{Bool2dCut, GeometryRouter, FIRES, FOOTPRINTS};
use crate::bool2d::{compute_signed_area, subtract_multiple_2d_all};
use crate::extrusion::{apply_transform, extrude_profile_watertight};
use crate::{Mesh, Profile2D};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
use nalgebra::{Matrix3, Matrix4, Point2, Point3, Vector3};
use std::sync::atomic::Ordering;

#[path = "thin_box_retry.rs"]
pub(super) mod retry;

/// Exact four-corner rectangle proof, including indexed-polycurve profiles.
/// Unlike the tolerant rectangular probe, a trapezoid/shear cannot enter here.
fn clean_box(host: &ExtrudedSolidInfo, scale: f64, rtc: (f64, f64, f64)) -> Option<RectParam> {
    if !finite_solid(host, scale, rtc) { return None; }
    let mut p = host.profile.outer.as_slice();
    if p.len() == 5 && (p[0] - p[4]).norm() < 1e-10 { p = &p[..4]; }
    if p.len() != 4 { return None; }
    let a = p[1] - p[0];
    let b = p[3] - p[0];
    let tolerance = a.norm().max(b.norm()) * 1e-9;
    if a.norm() <= 0.0 || b.norm() <= 0.0
        || a.dot(&b).abs() > a.norm() * b.norm() * 1e-9
        || (p[2] - (p[0] + a + b)).norm() > tolerance { return None; }
    let rot = host.m.fixed_view::<3, 3>(0, 0);
    let edges = [rot * Vector3::new(a.x, a.y, 0.0),
        rot * Vector3::new(b.x, b.y, 0.0),
        rot * Vector3::new(0.0, 0.0, host.dir_sign * host.depth)];
    let axes = edges.map(|e| e.try_normalize(1e-12)).into_iter().collect::<Option<Vec<_>>>()?;
    if (0..3).any(|i| axes[i].dot(&axes[(i + 1) % 3]).abs() > 1e-9) { return None; }
    let c = (p[0].coords + p[2].coords) * 0.5;
    let c = host.m.transform_point(&Point3::new(c.x, c.y, host.dir_sign * host.depth * 0.5));
    let center = Point3::new(c.x * scale - rtc.0, c.y * scale - rtc.1, c.z * scale - rtc.2);
    let half = edges.map(|e| e.norm() * scale * 0.5);
    if !half.iter().all(|h| h.is_finite() && *h > 0.0) { return None; }
    Some(RectParam { r: Matrix3::from_columns(&[axes[0], axes[1], axes[2]]), center, half })
}

impl GeometryRouter {
    pub(super) fn capture_thin_box_cut(
        &self, element: &DecodedEntity, opening_ids: &[u32], decoder: &mut EntityDecoder,
    ) -> Option<Bool2dCut> {
        let solid = self.host_extruded_solid(element, decoder)?;
        let host = clean_box(&solid, self.unit_scale, self.rtc_offset)?;
        let thin = (0..3).min_by(|&a, &b| host.half[a].total_cmp(&host.half[b]))?;
        // Only reorient when the authored sweep is NOT the thickness, and the
        // plate has an unambiguous thin axis. Normal sweeps keep the old route.
        if thin == 2 || (0..3).any(|i| i != thin && host.half[thin] * 8.0 > host.half[i]) {
            return None;
        }
        let x = (thin + 1) % 3;
        let y = (thin + 2) % 3;
        let mut r = Matrix3::from_columns(&[host.r.column(x).into_owned(),
            host.r.column(y).into_owned(), host.r.column(thin).into_owned()]);
        // Clockwise source profiles/reflections still need a right-handed sweep.
        if r.determinant() < 0.0 { r.set_column(0, &(-r.column(0).into_owned())); }
        let depth = host.half[thin] * 2.0;
        let base = host.center.coords - r.column(2) * host.half[thin];
        let mut wt = Matrix4::identity();
        wt.fixed_view_mut::<3, 3>(0, 0).copy_from(&r);
        wt.fixed_view_mut::<3, 1>(0, 3).copy_from(&base);
        let inv = wt.try_inverse()?;
        let mut footprints = Vec::new();
        let mut residual_ids=Vec::new();
        for &id in opening_ids {
            let opening = decoder.decode_by_id(id).ok()?;
            if !opening.ifc_type.is_subtype_of(IfcType::IfcFeatureElementSubtraction) { return None; }
            let tentative=self.opening_extruded_solids(&opening,decoder).and_then(|solids|
                solids.iter().map(|op|thin_footprint_impl(op,&inv,depth,self.unit_scale,self.rtc_offset,self.precision_frame.is_some())).collect::<Option<Vec<_>>>());
            if let Some(mut eligible)=tentative {footprints.append(&mut eligible);}
            else if self.precision_frame.is_some(){residual_ids.push(id);}
            else {return None;}
        }
        let residual=if residual_ids.is_empty(){None}else{
            let openings=self.classify_openings_quiet(element,&residual_ids,decoder);
            if openings.is_empty(){return None;}
            Some(Box::new(super::super::VoidContext {
                merged_openings:openings.clone(),openings,param:None,bool2d:None,
            }))
        };
        if footprints.is_empty() { return None; }
        let (a, b) = (host.half[x], host.half[y]);
        Some(Bool2dCut {
            all_components: true,
            rectangular_boundary: true,
            common_fallback: None,
            boundary_precision: retry::context_precision(element, decoder, self.unit_scale),
            host_profile: Profile2D::new(vec![Point2::new(-a, -b), Point2::new(a, -b),
                Point2::new(a, b), Point2::new(-a, b)]),
            depth, dir_sign: 1.0, wt, footprints, residual,
        })
    }

    pub(super) fn try_thin_box_cut(&self, mesh: &Mesh, cut: &Bool2dCut) -> Option<Mesh> {
        if !reconciles(mesh, cut) { return None; }
        let profiles = subtract_multiple_2d_all(&cut.host_profile, &cut.footprints).ok()?;
        if let Some(out) = self.emit_thin_profiles(cut, &profiles) { return Some(out); }
        // Preserve the original successful route byte-for-byte. Retry only a
        // refused result, with explicit source Precision and an area envelope.
        let (footprints, envelope) = retry::regularize(cut)?;
        let revised = subtract_multiple_2d_all(&cut.host_profile, &footprints).ok()?;
        if revised.len() < profiles.len()
            || (profile_area(&revised) - profile_area(&profiles)).abs() > envelope { return None; }
        self.emit_thin_profiles(cut, &revised)
    }

    fn emit_thin_profiles(&self, cut: &Bool2dCut, profiles: &[Profile2D]) -> Option<Mesh> {
        let area = |p: &Profile2D| compute_signed_area(&p.outer).abs()
            - p.holes.iter().map(|h| compute_signed_area(h).abs()).sum::<f64>();
        let expected = profiles.iter().map(area).sum::<f64>() * cut.depth;
        if expected <= 0.0 { return None; }
        // Put the f64 translation in origin BEFORE storing any transformed f32
        // positions. Native and WASM both keep the 16 mm plate at small coords.
        let origin = [cut.wt[(0, 3)], cut.wt[(1, 3)], cut.wt[(2, 3)]];
        let mut wt = cut.wt;
        for i in 0..3 { wt[(i, 3)] = 0.0; }
        let mut out = Mesh::new();
        for profile in profiles {
            let mut part = extrude_profile_watertight(profile, cut.depth, None).ok()?;
            apply_transform(&mut part, &wt);
            part.origin = origin;
            part.clean_degenerate();
            if !param_cut_watertight(&part) || !retry::closed_manifold(&part) { return None; }
            out.merge(&part);
        }
        // Preserve every disconnected solid; validate their summed material,
        // so an empty/degenerate triangulation can never silently lose a part.
        if !param_cut_watertight(&out)
            || !retry::closed_manifold(&out)
            || (mesh_signed_volume(&out).abs() - expected).abs() > expected * 1e-4 { return None; }
        let footprints = cut.footprints.len() as u64;
        crate::telemetry_transaction::record(move || {
            FIRES.fetch_add(1, Ordering::Relaxed);
            FOOTPRINTS.fetch_add(footprints, Ordering::Relaxed);
        });
        Some(out)
    }
}

fn profile_area(profiles: &[Profile2D]) -> f64 {
    profiles.iter().map(|p| compute_signed_area(&p.outer).abs()
        - p.holes.iter().map(|h| compute_signed_area(h).abs()).sum::<f64>()).sum()
}

pub(super) fn thin_footprint(
    op: &ExtrudedSolidInfo, inv: &Matrix4<f64>, depth: f64, scale: f64, rtc: (f64, f64, f64),
) -> Option<Vec<Point2<f64>>> {
    thin_footprint_impl(op,inv,depth,scale,rtc,false)
}

pub(super) fn thin_footprint_impl(
    op: &ExtrudedSolidInfo, inv: &Matrix4<f64>, depth: f64, scale: f64, rtc: (f64, f64, f64), source_roundoff:bool,
) -> Option<Vec<Point2<f64>>> {
    if !finite_solid(op, scale, rtc) || !depth.is_finite() || depth <= 0.0
        || !inv.iter().all(|x| x.is_finite()) { return None; }
    let mut world = op.m;
    for i in 0..3 { for j in 0..4 { world[(i, j)] *= scale; } }
    for (i, shift) in [rtc.0, rtc.1, rtc.2].into_iter().enumerate() { world[(i, 3)] -= shift; }
    let to_host = inv * world;
    let sweep = to_host.transform_vector(&Vector3::new(0.0, 0.0, op.dir_sign * op.depth));
    let axis=sweep.try_normalize(1e-12)?;
    if !source_roundoff && axis.x.hypot(axis.y)>1e-7{return None;}
    // At most 0.25 micrometres + 1 ppm of thickness may be treated as a
    // coincident plane. Real #2444 has ~0.08 um exporter drift and 6.57e-8 rad
    // axis drift; every profile vertex must independently span both faces.
    // This narrow metric bound is unrelated to footprint/host size or location.
    let tol = 2.5e-7 + depth * 1e-6;
    if sweep.x.hypot(sweep.y) > tol { return None; }
    let mut footprint = Vec::new();
    for p in &op.profile.outer {
        let base = to_host.transform_point(&Point3::new(p.x, p.y, 0.0));
        let far = base + sweep;
        if base.z.min(far.z) > tol || base.z.max(far.z) < depth - tol { return None; }
        footprint.push(Point2::new((base.x + far.x) * 0.5, (base.y + far.y) * 0.5));
    }
    (footprint.len() >= 3 && compute_signed_area(&footprint).abs() > 0.0).then_some(footprint)
}

fn finite_solid(op: &ExtrudedSolidInfo, scale: f64, rtc: (f64, f64, f64)) -> bool {
    op.profile.holes.is_empty() && op.depth.is_finite() && op.depth > 0.0
        && op.dir_sign.is_finite() && op.dir_sign.abs() == 1.0 && scale.is_finite() && scale > 0.0
        && [rtc.0, rtc.1, rtc.2].iter().all(|x| x.is_finite())
        && op.m.iter().all(|x| x.is_finite())
        && op.profile.outer.iter().all(|p| p.x.is_finite() && p.y.is_finite())
}

/// Reconcile the proven rectangle against the actual pre-cut mesh in its small
/// box frame. Catches unit/RTC/placement mistakes and any source-shape mismatch.
fn reconciles(mesh: &Mesh, cut: &Bool2dCut) -> bool {
    let Some(inv) = cut.wt.try_inverse() else { return false; };
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    let mut magnitude = 0.0_f64;
    for v in mesh.positions.as_chunks::<3>().0 {
        let p = inv.transform_point(&Point3::new(v[0] as f64 + mesh.origin[0],
            v[1] as f64 + mesh.origin[1], v[2] as f64 + mesh.origin[2]));
        for i in 0..3 {
            magnitude = magnitude.max(f64::from(v[i]).abs());
            lo[i] = lo[i].min(p[i]); hi[i] = hi[i].max(p[i]);
        }
    }
    let mut expected_lo = [f64::INFINITY, f64::INFINITY, 0.0];
    let mut expected_hi = [f64::NEG_INFINITY, f64::NEG_INFINITY, cut.depth];
    for p in &cut.host_profile.outer { for i in 0..2 {
        expected_lo[i] = expected_lo[i].min(p[i]);
        expected_hi[i] = expected_hi[i].max(p[i]);
    }}
    let tolerance = 2e-5 + magnitude * f64::from(f32::EPSILON) * 4.0;
    if (0..3).any(|i| (lo[i] - expected_lo[i]).abs() > tolerance
        || (hi[i] - expected_hi[i]).abs() > tolerance) { return false; }
    let volume = profile_area(std::slice::from_ref(&cut.host_profile)) * cut.depth;
    (mesh_signed_volume(mesh).abs() - volume).abs() <= volume * 0.002
}

#[cfg(test)]
#[path = "thin_box_tests.rs"]
mod tests;
