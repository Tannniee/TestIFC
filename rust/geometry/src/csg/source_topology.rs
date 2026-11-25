// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Exact-kernel output for a caller that validates stored topology
//! after ordinary hygiene. Coplanar consolidation is a separate candidate,
//! because independent plane retessellation can reopen an otherwise exact cut.
use super::{record_csg_op,ClippingProcessor};
use crate::Mesh;

impl ClippingProcessor {
    pub(crate) fn subtract_source_meshes(&self,host:&Mesh,cutters:&[&Mesh])->Option<Mesh> {
        if cutters.len()>super::group_cut::MAX_CUTTERS_PER_ARRANGEMENT{return None;}
        record_csg_op(0,host.triangle_count(),cutters.iter().map(|mesh|mesh.triangle_count()).sum());
        crate::kernel::budget::begin();
        let raw=match crate::kernel::source_bridge::subtract_many(host,cutters) {
            crate::kernel::mesh_bridge::BatchSubtract::Cut(mesh)=>mesh,
            crate::kernel::mesh_bridge::BatchSubtract::Unchanged=>host.clone(),
            crate::kernel::mesh_bridge::BatchSubtract::Nonconforming=>return None,
        };
        if crate::kernel::budget::tripped() || (!raw.is_empty() && !self.validate_mesh(&raw))
            || self.accept_gates_reject(crate::diagnostics::BoolOp::Difference,&raw){return None;}
        Some(raw)
    }
    pub(crate) fn subtract_source_mesh(&self,host:&Mesh,cutter:&Mesh)->Option<Mesh> {
        record_csg_op(0,host.triangle_count(),cutter.triangle_count());
        crate::kernel::budget::begin();
        // Match subtract_mesh's single-cutter lenient classifier contract;
        // the scoped caller additionally requires exact stored closure.
        let (raw,changed,conforming)=crate::kernel::source_bridge::subtract(host,cutter);
        if crate::kernel::budget::tripped() { return None; }
        if raw.is_empty() && (!changed || !conforming) { return None; }
        if !raw.is_empty() && !self.validate_mesh(&raw) { return None; }
        if self.accept_gates_reject(crate::diagnostics::BoolOp::Difference,&raw) { return None; }
        Some(raw)
    }
}
