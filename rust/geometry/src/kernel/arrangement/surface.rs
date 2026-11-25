// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Exact and import-reconciled shared-surface probes.
use super::super::{predicates::{orient2d_any, orient3d}, DropAxis, ImplicitPoint, Sign};
use super::{classify::{cross3, dot3, sub_f64}, coincident::coincident_planes, Tri};
fn e(p: [f64; 3]) -> ImplicitPoint { ImplicitPoint::Explicit(p) }

fn drop_axis_of(n: [f64; 3]) -> DropAxis {
    let an = [n[0].abs(), n[1].abs(), n[2].abs()];
    if an[0] >= an[1] && an[0] >= an[2] {
        DropAxis::X
    } else if an[1] >= an[2] {
        DropAxis::Y
    } else {
        DropAxis::Z
    }
}

/// If point `c` lies exactly on a triangle of `others` (coplanar AND inside it),
/// return that triangle's f64 normal — i.e. detect that a sub-triangle whose
/// centroid is `c` sits on a coplanar SHARED face of the other operand.
/// Exact in-plane containment: with `n` the un-normalised face normal of `t`, is
/// `c` strictly inside `t`'s outline projected onto the dropped axis? Shared by the
/// exact and near coplanar-surface tests; false for a degenerate projected `t`.
fn point_in_tri_proj(c: [f64; 3], t: &Tri, n: [f64; 3]) -> bool {
    let axis = drop_axis_of(n);
    let w0 = orient2d_any(&e(t[0]), &e(t[1]), &e(t[2]), axis);
    if w0 == Sign::Zero {
        return false; // degenerate t in projection
    }
    let inside = |u: [f64; 3], v: [f64; 3]| orient2d_any(&e(u), &e(v), &e(c), axis) != w0.flip();
    inside(t[0], t[1]) && inside(t[1], t[2]) && inside(t[2], t[0])
}

/// Per-triangle exact coincident-face test (see [`on_surface_normal`]).
pub(super) fn on_surface_tri(c: [f64; 3], t: &Tri) -> Option<[f64; 3]> {
    if orient3d(&e(t[0]), &e(t[1]), &e(t[2]), &e(c)) != Sign::Zero {
        return None; // c not on t's plane
    }
    let n = cross3(sub_f64(t[1], t[0]), sub_f64(t[2], t[0]));
    point_in_tri_proj(c, t, n).then_some(n)
}

/// Per-triangle near-coplanar-flush test (see [`near_on_surface_normal`]); the
/// plane-gap tolerance is resolved from `band` against THIS triangle's own
/// normal, so an operand offset along an axis this face does not face cannot
/// widen it.
fn near_on_surface_tri(c: [f64; 3], t: &Tri, band: &NearBand) -> Option<[f64; 3]> {
    let n = cross3(sub_f64(t[1], t[0]), sub_f64(t[2], t[0]));
    let nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
    if nn <= 0.0 || !nn.is_finite() {
        return None; // degenerate t
    }
    let d = dot3(sub_f64(c, t[0]), n); // perp_dist · |n|, as `scaled_band2` is
    if d * d > band.scaled_band2(n, nn) {
        return None; // c not within the snap band of t's plane
    }
    point_in_tri_proj(c, t, n).then_some(n)
}

/// First triangle of `others` that carries `c` on its face AND is near-parallel
/// to the sub-triangle whose raw normal is `n_own` ([`coincident_planes`]).
pub(super) fn on_surface_normal(c: [f64; 3], n_own: [f64; 3], others: &[Tri]) -> Option<[f64; 3]> {
    others
        .iter()
        .find_map(|t| on_surface_tri(c, t).filter(|n| coincident_planes(n_own, *n)))
}

/// Canonical near-coplanar band (see [`near_on_surface_normal`]): the
/// `SNAP_GRID` scatter envelope plus the operands' per-axis extents projected
/// onto the plane under test, defined once in `near_band`.
use super::super::near_band::NearBand;


/// BVH-accelerated equivalent of `on_surface_normal(c, a).is_some() ||
/// near_on_surface_normal(c, a).is_some()` — does ANY triangle of `a` carry `c` on
/// its face (exactly or within the snap band)? `a_band` carries `a`'s per-axis
/// coordinate extents (hoisted once per arrangement, since only `c` varies per
/// call). The query radius is [`NearBand::radius`], the isotropic UPPER bound
/// over every plane normal — never the max-over-axes scalar, which is NOT such
/// a bound and could drop a candidate the per-triangle test would accept — so
/// candidates stay a superset and the exact per-triangle predicates decide; the
/// result is `any`, so it is candidate-order independent and byte-identical to
/// the linear scan.
pub(super) fn c_on_or_near_a(
    c: [f64; 3],
    n_own: [f64; 3],
    a: &[Tri],
    bvh: &super::super::broadphase::Bvh,
    a_band: Option<&NearBand>,
    scratch: &mut Vec<u32>,
) -> bool {
    let mut band = a_band.copied().unwrap_or_default();
    band.observe_point(&c);
    scratch.clear();
    bvh.point_candidates(c, band.radius(), scratch);
    scratch.iter().any(|&i| {
        let t = &a[i as usize];
        on_surface_tri(c, t)
            .or_else(|| a_band.and_then(|_| near_on_surface_tri(c, t, &band)))
            .is_some_and(|n| coincident_planes(n_own, n))
    })
}
