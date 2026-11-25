// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The same arrangement kernel for proved finite source solids. Cross-operand
//! promotion and near-surface reconciliation would erase authored positive gaps.
use super::{arrangement::{
    difference_all_lenient_with_conformity_and_policy,
}, mesh_bridge::{mesh_to_tris, orient_outward, tris_to_mesh_without_plane_tags, BatchSubtract},
surface_policy::SurfacePolicy};
use crate::Mesh;

pub(crate) fn subtract(host: &Mesh, cutter: &Mesh) -> (Mesh, bool, bool) {
    let host = orient_outward(mesh_to_tris(host));
    let cutter = orient_outward(mesh_to_tris(cutter));
    let (triangles, changed, conforming) = difference_all_lenient_with_conformity_and_policy(
        &host, &[&cutter], SurfacePolicy::SourceStrict,
    );
    (tris_to_mesh_without_plane_tags(&triangles), changed, conforming)
}

pub(crate) fn subtract_many(host: &Mesh, cutters: &[&Mesh]) -> BatchSubtract {
    let host = orient_outward(mesh_to_tris(host));
    let cutters: Vec<_> = cutters.iter().map(|mesh| orient_outward(mesh_to_tris(mesh))).collect();
    let refs: Vec<_> = cutters.iter().map(Vec::as_slice).collect();
    match super::arrangement::finite_difference::difference(&host, &refs) {
        Some((triangles, true)) => BatchSubtract::Cut(tris_to_mesh_without_plane_tags(&triangles)),
        Some((_, false)) => BatchSubtract::Unchanged,
        None => BatchSubtract::Nonconforming,
    }
}

#[cfg(any(test, feature="test-support"))]
pub(crate) fn union_many(meshes: &[&Mesh]) -> Option<Mesh> {
    super::budget::begin();
    let triangles: Vec<_> = meshes.iter().map(|mesh| orient_outward(mesh_to_tris(mesh))).collect();
    let refs: Vec<_> = triangles.iter().map(Vec::as_slice).collect();
    let (out, conforming) = super::arrangement::union_all_with_policy(&refs, SurfacePolicy::SourceStrict);
    (conforming && !super::budget::tripped()).then(|| tris_to_mesh_without_plane_tags(&out))
}
