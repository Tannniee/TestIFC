// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Finite manufacturing cuts in the stock's authored coordinate frame.
//! Repair only the failing cutter; previously accepted cuts stay untouched.
use super::{world_host_bounds,precision_seams,frame_snap::enclosed_volume,GeometryRouter,OpeningType,VoidContext};
use crate::{csg::ClippingProcessor,Mesh};
impl GeometryRouter {
    pub(super) fn cut_authored_solids(&self,mut mesh:Mesh,ctx:&VoidContext,id:u32)->Mesh {
        let before=mesh.triangle_count();let bounds=world_host_bounds(&mesh);
        for (stage,opening) in ctx.openings.iter().enumerate() {
            let OpeningType::NonRectangular(cutter,..)=opening else {return Mesh::new();};
            if cutter.is_empty() {return Mesh::new();}
            let (lo,hi)=mesh.bounds();let (clo,chi)=cutter.bounds();
            if (0..3).any(|i|chi[i]<lo[i] || clo[i]>hi[i]) {continue;}
            let result=self.cut_authored_one(&mesh,opening).or_else(||{
                for clearance in [2.,4.,8.,12.] {
                    let Some(revised)=super::source_retry::cutter_at_precision(cutter,&mesh,self.precision_frame.unwrap_or(0.),clearance) else {continue;};
                    let (a,b)=revised.bounds();
                    let candidate=OpeningType::NonRectangular(revised,a.cast(),b.cast(),None);
                    if let Some(result)=self.cut_authored_one(&mesh,&candidate) {return Some(result);}
                }
                None
            });
            let Some(result)=result else {eprintln!("source #{id} refused cutter stage {stage}");return Mesh::new();};
            if std::env::var_os("IFC_LITE_RESEARCH_MESH").is_some() && [490757,281338].contains(&id) {
                eprintln!("source #{id} stage {stage}: volume {} -> {}",enclosed_volume(&mesh).abs(),enclosed_volume(&result).abs());
            }
            mesh=result;if mesh.is_empty(){break;}
        }
        if mesh.is_empty(){self.voids_consumed_hosts.borrow_mut().insert(id);}
        self.record_host_cut_effect(id,before,mesh.triangle_count(),0,bounds);
        mesh
    }
    fn cut_authored_one(&self,stock:&Mesh,opening:&OpeningType)->Option<Mesh> {
        let OpeningType::NonRectangular(cutter,..)=opening else {return None;};
        let precision=self.precision_frame?;let clipper=ClippingProcessor::new();
        let mut next=super::source_plane::cut_boundary_plane(stock,cutter,&clipper,precision)
            .or_else(||clipper.subtract_source_mesh(stock,cutter))?;
        if next.is_empty(){return Some(next);}
        super::source_hygiene::clean(&mut next,precision);
        let raw_closed=precision_seams::close_with_precision(&mut next,precision);
        let volume=enclosed_volume(&next).abs();
        let mut consolidated=clipper.consolidate(next.clone());
        super::source_hygiene::clean(&mut consolidated,precision);
        let consolidated_closed=precision_seams::close_with_precision(&mut consolidated,precision);
        let chosen=if consolidated_closed && (!raw_closed || (enclosed_volume(&consolidated).abs()-volume).abs()<=volume*1e-5) {
            consolidated
        }else if raw_closed {next}else{
            if !super::prism_cut::enabled(){return None;}
            let single=VoidContext {openings:vec![opening.clone()],merged_openings:vec![opening.clone()],param:None,bool2d:None};
            let (mut result,residual)=self.try_prism_cut(stock,&single)?;
            if residual.is_some(){return None;}
            super::source_hygiene::clean(&mut result,precision);
            if !precision_seams::close_with_precision(&mut result,precision){return None;}
            result
        };
        let (lo,hi)=stock.bounds();let (nlo,nhi)=chosen.bounds();
        let grid=crate::kernel::mesh_bridge::SNAP_GRID;
        if (0..3).any(|i|f64::from(nlo[i])<f64::from(lo[i])-2.*grid || f64::from(nhi[i])>f64::from(hi[i])+2.*grid){return None;}
        let span=(hi-lo).map(f64::from);
        let envelope=2.*(span.x*span.y+span.y*span.z+span.z*span.x)*grid;
        if enclosed_volume(&chosen).abs()>enclosed_volume(stock).abs()+envelope{return None;}
        Some(chosen)
    }
}
