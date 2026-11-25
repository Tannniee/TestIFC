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
    keep_face_using(n, owner, meshes.len(), |other| {
        if let Some(normal) = on_surface_normal(c, n, meshes[other]) { Probe::Surface(normal) }
        else if point_inside(c, meshes[other], extents[other], bounds[other]) { Probe::Inside }
        else { Probe::Outside }
    })
}

pub(super) enum Probe { Surface([f64; 3]), Inside, Outside }

/// Keep the finite-source coincident-face ownership rule shared by union and
/// subtraction; callers can filter candidates without changing this decision.
pub(super) fn keep_face_using(
    n: [f64; 3], owner: usize, count: usize, mut probe: impl FnMut(usize) -> Probe,
) -> bool {
    for other in 0..count {
        if other == owner { continue; }
        match probe(other) {
            Probe::Surface(normal) if dot3(n, normal) <= 0. || other < owner => return false,
            Probe::Inside => return false,
            Probe::Surface(_) | Probe::Outside => {},
        }
    }
    true
}
