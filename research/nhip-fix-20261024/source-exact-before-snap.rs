// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! In the stock frame, manufacturing features are their authored solids.
//! Architectural penetration extension, minimum window volume and AABB repair
//! would change a blind pocket, sloping wedge or small bolt hole.
use super::{world_host_bounds, precision_seams, frame_snap::enclosed_volume, GeometryRouter, OpeningType, VoidContext};
use crate::{csg::ClippingProcessor,Mesh};

impl GeometryRouter {
    pub(super) fn cut_authored_solids(&self, mut mesh:Mesh, ctx:&VoidContext, id:u32)->Mesh {
        let before=mesh.triangle_count();
        let bounds=world_host_bounds(&mesh);
        let clipper=ClippingProcessor::new();
        for opening in &ctx.openings {
            let cutter=match opening {
                OpeningType::NonRectangular(cutter,..)=>cutter,
                // The scoped classifier always supplies a true mesh. Refuse
                // the whole speculative operation if that contract changes.
                _=>return Mesh::new(),
            };
            if cutter.is_empty() { return Mesh::new(); }
            let (lo,hi)=mesh.bounds(); let (clo,chi)=cutter.bounds();
            if (0..3).any(|axis|chi[axis]<lo[axis] || clo[axis]>hi[axis]) { continue; }
            let single=VoidContext { openings:vec![opening.clone()],merged_openings:vec![opening.clone()],param:None,bool2d:None };
            let analytic=if super::prism_cut::enabled() { self.try_prism_cut(&mesh,&single)
                .filter(|(_,residual)|residual.is_none()).map(|(mut result,_)|{
                    result.clean_degenerate_watertight(); result.clean_degenerate();
                    precision_seams::close_with_precision(&mut result,self.precision_frame.unwrap_or(0.)).then_some(result)
                }).flatten()
            }else{None};
            let mut next=match super::source_plane::cut_boundary_plane(&mesh,cutter,&clipper,self.precision_frame.unwrap_or(0.)).or(analytic) {
                Some(result)=>result,
                None=>{ let Some(result)=clipper.subtract_source_mesh(&mesh,cutter) else { eprintln!("source raw refusal #{id}"); return Mesh::new(); }; result }
            };
            if next.is_empty() { mesh=next; break; }
            if let Ok(directory)=std::env::var("IFC_LITE_RESEARCH_MESH") {
                let path=std::path::Path::new(&directory).join(format!("{id}-{}.json",mesh.triangle_count()));
                std::fs::write(path,format!("{{\"positions\":{:?},\"indices\":{:?}}}",next.positions,next.indices)).expect("research mesh dump");
            }
            next.clean_degenerate_watertight(); next.clean_degenerate();
            let raw_closed=precision_seams::close_with_precision(&mut next,self.precision_frame.unwrap_or(0.));
            // Keep consolidation only when it preserves the exact solid AND
            // the stored, post-cleanup topology; otherwise keep the raw cut.
            let mut consolidated=clipper.consolidate(next.clone());
            consolidated.clean_degenerate_watertight(); consolidated.clean_degenerate();
            let consolidated_closed=precision_seams::close_with_precision(&mut consolidated,self.precision_frame.unwrap_or(0.));
            if !raw_closed && !consolidated_closed { if let Ok(directory)=std::env::var("IFC_LITE_RESEARCH_MESH") {
                for (label,value) in [("raw",&next),("consolidated",&consolidated)] {
                    std::fs::write(std::path::Path::new(&directory).join(format!("{id}-bad-{label}.json")),format!("{{\"positions\":{:?},\"indices\":{:?}}}",value.positions,value.indices)).expect("research mesh dump");
                }
            }}
            let volume=enclosed_volume(&next).abs();
            let chosen=if consolidated_closed && (!raw_closed
                || (enclosed_volume(&consolidated).abs()-volume).abs()<=volume*1e-5) {
                consolidated
            }else if raw_closed {next}else{eprintln!("source closure refusal #{id}: raw {} consolidated {}",next.triangle_count(),consolidated.triangle_count());return Mesh::new();};
            // Difference cannot grow stock or emit a far-away shard. Allow
            // only the existing kernel-grid quantization envelope.
            let (nlo,nhi)=chosen.bounds();
            let grid=crate::kernel::mesh_bridge::SNAP_GRID;
            if (0..3).any(|i|f64::from(nlo[i])<f64::from(lo[i])-2.*grid
                || f64::from(nhi[i])>f64::from(hi[i])+2.*grid) { eprintln!("source bounds refusal #{id}"); return Mesh::new(); }
            let span=(hi-lo).map(f64::from);
            let envelope=2.*(span.x*span.y+span.y*span.z+span.z*span.x)*grid;
            if enclosed_volume(&chosen).abs()>enclosed_volume(&mesh).abs()+envelope { eprintln!("source volume refusal #{id}"); return Mesh::new(); }
            mesh=chosen;
        }
        if mesh.is_empty() { self.voids_consumed_hosts.borrow_mut().insert(id); }
        let failures=clipper.take_failures();
        if !failures.is_empty() {
            self.record_host_failure_summary(id,&failures);
            self.record_csg_failures(id,failures);
        }
        self.record_host_cut_effect(id,before,mesh.triangle_count(),0,bounds);
        mesh
    }
}
