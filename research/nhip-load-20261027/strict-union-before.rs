// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Finite source solids keep positive gaps, including gaps smaller than a
//! normal-offset probe. True coincident faces have one deterministic owner.
use super::{classify::dot3, surface::on_surface_normal, ray_parity::point_inside, Tri};
use super::super::broadphase::Aabb;

pub(super) fn keep_face(
    c: [f64; 3], n: [f64; 3], owner: usize,
    meshes: &[&[Tri]], extents: &[f64], bounds: &[Aabb],
) -> bool {
    for (other, mesh) in meshes.iter().enumerate() {
        if other == owner { continue; }
        if let Some(other_normal) = on_surface_normal(c, n, mesh) {
            if dot3(n, other_normal) <= 0. || other < owner { return false; }
        } else if point_inside(c, mesh, extents[other], bounds[other]) {
            return false;
        }
    }
    true
}
