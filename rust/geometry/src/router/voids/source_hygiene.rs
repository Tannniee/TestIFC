// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A valid finite boundary is not a degenerate triangle merely because its
//! altitude is below the import grid. Dropping such a face can open an authored
//! blind pocket. Remove truly collapsed faces; the caller's bounded boundary
//! repair conforms resulting seams without deleting adjacent finite faces.
use super::precision_seams::closed_manifold;
use crate::Mesh;

pub(crate) fn repair_closed_input(mesh:&mut Mesh,precision:f64)->bool {
    if closed_manifold(mesh){return true;}
    let mut candidate=mesh.clone();clean(&mut candidate);
    let mut oriented=candidate.clone();
    let verdict=crate::orient_mesh_outward_verdict(&mut oriented);
    if verdict.is_single_closed_solid(){candidate=oriented;}
    clean(&mut candidate);
    if !super::precision_seams::close_with_precision(&mut candidate,precision){return false;}
    crate::calculate_normals(&mut candidate);*mesh=candidate;true
}

pub(crate) fn clean(mesh:&mut Mesh) {
    // An exact arrangement face can collapse on f32 emission. Remove only
    // zero-area faces first: the ordinary near-degenerate cleanup would also
    // drop neighbours that still bound material. This pass removes no finite
    // material surface.
    if crate::drop_collapsed_triangles(&mesh.positions,&mut mesh.indices)>0 {mesh.plane_tags=None;}
}

#[cfg(test)]
#[path="source_hygiene_tests.rs"]
mod tests;
