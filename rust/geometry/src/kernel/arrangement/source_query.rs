// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Spatial filtering for finite-source classification. Only the candidate
//! search changes: exact surface/crossing predicates still decide every face.
use super::{classify::point_inside_bvh, coincident::coincident_planes,
    ray_parity::operand_extent, surface::on_surface_tri, Tri};
use super::super::broadphase::Bvh;

pub(super) struct Operand<'a> {
    triangles: &'a [Tri],
    tree: Bvh,
    extent: f64,
}

impl<'a> Operand<'a> {
    pub(super) fn new(triangles: &'a [Tri]) -> Self {
        Self { triangles, tree: Bvh::build(triangles), extent: operand_extent(triangles) }
    }

    pub(super) fn surface_normal(&self, point: [f64; 3], normal: [f64; 3], scratch: &mut Vec<u32>) -> Option<[f64; 3]> {
        scratch.clear();
        self.tree.point_candidates(point, 0.0, scratch);
        // Linear classification picks the FIRST covering face in source order.
        // BVH traversal order must not change ownership of coincident faces.
        scratch.sort_unstable();
        scratch.iter().find_map(|&index| on_surface_tri(point, &self.triangles[index as usize])
            .filter(|&other| coincident_planes(normal, other)))
    }

    pub(super) fn contains(&self, point: [f64; 3], scratch: &mut Vec<u32>) -> bool {
        point_inside_bvh(point, self.triangles, &self.tree, self.extent, scratch)
    }
}

#[cfg(test)]
#[path = "source_query_tests.rs"]
mod tests;
