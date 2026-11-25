// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The f32-collapse degenerate-triangle backstop: the env switch that disables
//! it, the drop itself, and the per-element tally of what it removed.
//!
//! Split out of the parent `element` module (whose child it is) because the
//! tally stopped being a pure diagnostic. It is now load-bearing for the #1891
//! closure verdict: the backstop is the ONE step of the per-`MeshData` funnel
//! that changes a mesh's topology, and it runs AFTER
//! `orient_mesh_outward_verdict` has already handed the hasher its verdict. A
//! dropped triangle takes its three welded edges with it, opening every
//! neighbour along them, so an element that drops anything can no longer be
//! certified closed — see
//! `GeometryHasher::retract_closure_if_mesh_edited`, which
//! `produce_element_meshes` feeds [`dropped_this_element`] into before reading
//! the verdict out.

use ifc_lite_geometry::Mesh;
use std::cell::Cell;

thread_local! {
    /// Per-element drop tally. Reset by [`begin_element`], incremented by
    /// [`clean`], read by [`dropped_this_element`].
    ///
    /// Thread-local, scoped by [`begin_element`]'s guard: a native rayon worker
    /// can run a stolen element to completion in the middle of another one, so
    /// the scope saves the enclosing element's tally and restores it on drop.
    static DROPPED: Cell<u64> = const { Cell::new(0) };
}

/// Whether the backstop is disabled.
///
/// On by default. Set `IFC_LITE_DISABLE_DEGENERATE_BACKSTOP=1` to keep the raw
/// (possibly fan-corrupted) triangles — an escape hatch for debugging the
/// heuristic or measuring exactly what it removes. Read once and cached.
fn disabled() -> bool {
    static DISABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *DISABLED.get_or_init(|| std::env::var("IFC_LITE_DISABLE_DEGENERATE_BACKSTOP").is_ok())
}

/// One element's open tally scope; dropping it restores the enclosing
/// element's tally.
#[must_use = "dropping the scope immediately restores the enclosing element's tally"]
pub(crate) struct ElementTally {
    saved: u64,
    /// Not `Send`: it restores this thread's tally, so it must drop here.
    _thread_bound: std::marker::PhantomData<*const ()>,
}

impl Drop for ElementTally {
    fn drop(&mut self) {
        DROPPED.with(|c| c.set(self.saved));
    }
}

/// Open one element's tally scope.
pub(crate) fn begin_element() -> ElementTally {
    ElementTally {
        saved: DROPPED.with(|c| c.replace(0)),
        _thread_bound: std::marker::PhantomData,
    }
}

/// Drop this mesh's collapsed triangles, tallying how many went.
///
/// At building-scale world coordinates an f32 mantissa can't separate
/// sub-15 µm-apart vertices, so triangles collapse into zero-area / long-thin
/// "fan" slivers that visibly span large georeferenced models. This drops the
/// unambiguously-degenerate ones at the single per-element `MeshData` funnel.
/// With local-frame precision on, the mesh is stored relative to `origin` (small
/// coords) so collapse is PREVENTED upstream and this drops nothing; it stays as
/// the defence-in-depth safety net for any element still too large for its frame.
pub(crate) fn clean(mesh: &mut Mesh) {
    if disabled() {
        return;
    }
    let indices_before = mesh.indices.len();
    mesh.drop_degenerate_triangles();
    let dropped = ((indices_before - mesh.indices.len()) / 3) as u64;
    if dropped > 0 {
        DROPPED.with(|c| c.set(c.get() + dropped));
    }
}

/// Triangles dropped since [`begin_element`], across every mesh of this element.
pub(crate) fn dropped_this_element() -> u64 {
    DROPPED.with(|c| c.get())
}

/// Coordinate conversion can collapse faces even after a finite-source proof.
/// Remove only those faces, then conform exact boundary subdivisions. The
/// import aspect-ratio heuristic is inapplicable to a finite-source boundary.
pub(crate) struct FiniteSiteSource<'a> {
    pub positions:&'a [f32],
    pub indices:&'a [u32],
    pub origin:[f64;3],
    pub rotation:&'a [f64],
}

pub(crate) fn clean_finite_buffers(mesh:&mut crate::types::mesh::MeshData,source:Option<FiniteSiteSource<'_>>) {
    if disabled(){return;}
    let dropped=ifc_lite_geometry::drop_collapsed_triangles(&mesh.positions,&mut mesh.indices);
    if dropped==0{return;}
    if conform_finite(mesh) {
        DROPPED.with(|count|count.set(count.get()+dropped));return;
    }
    if mesh.uvs.is_none() {
        if let Some(source)=source.filter(|source|source.rotation.len()>=16) {
            // A final site rotation can merge two distinct nearby edges into
            // a four-use edge. One non-dyadic sub-ULP origin shift changes the
            // storage lattice; compensate in f64 so the placement is identical.
            let mut extent=[0_f32;3];
            for p in mesh.positions.as_chunks::<3>().0 {for i in 0..3 {extent[i]=extent[i].max(p[i].abs());}}
            let offset=extent.map(|v|f64::from(f32::from_bits(v.to_bits()+1)-v)/3.);
            let saved=(mesh.positions.clone(),mesh.normals.clone(),mesh.indices.clone(),mesh.origin);
            crate::processor::rebase_site_storage(mesh,source.positions,source.origin,source.rotation,offset);
            mesh.indices=source.indices.to_vec();
            let retry_dropped=ifc_lite_geometry::drop_collapsed_triangles(&mesh.positions,&mut mesh.indices);
            if conform_finite(mesh) {
                DROPPED.with(|count|count.set(count.get()+retry_dropped));return;
            }
            (mesh.positions,mesh.normals,mesh.indices,mesh.origin)=saved;
        }
    }
    DROPPED.with(|count|count.set(count.get()+dropped));
}

fn conform_finite(mesh:&mut crate::types::mesh::MeshData)->bool {
    // UV seams need their own attribute remapping; never append a position
    // without its UV. The edited tally still retracts an unproved closure.
    if mesh.uvs.is_some(){return false;}
    let mut geometry=Mesh::new();
    geometry.positions=std::mem::take(&mut mesh.positions);
    geometry.normals=std::mem::take(&mut mesh.normals);
    geometry.indices=std::mem::take(&mut mesh.indices);
    let conformed=ifc_lite_geometry::conform_exact_boundary(&geometry);
    let accepted=conformed.is_some();
    let geometry=conformed.unwrap_or(geometry);
    mesh.positions=geometry.positions;mesh.normals=geometry.normals;mesh.indices=geometry.indices;
    accepted
}
