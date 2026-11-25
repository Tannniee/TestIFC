// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Finite manufacturing cuts in the stock's authored coordinate frame.
//! Repair only the failing cutter; previously accepted cuts stay untouched.
use super::{world_host_bounds,precision_seams,frame_snap::enclosed_volume,GeometryRouter,OpeningType,VoidContext};
use crate::{csg::ClippingProcessor,Mesh};
impl GeometryRouter {
    pub(super) fn cut_authored_solids(&self,mesh:Mesh,ctx:&VoidContext,id:u32)->Mesh {
        if let Some(result)=self.try_authored_all(&mesh,ctx){
            self.record_authored_result(&mesh,&result,id);return result;
        }
        if let Some(result)=self.try_authored_solids(mesh.clone(),ctx,id,true){return result;}
        for clearance in [2.,4.,8.,12.] {
            let mut revised=ctx.relativized_by([0.;3]);
            for opening in &mut revised.openings {
                let OpeningType::NonRectangular(cutter,..)=opening else{return Mesh::new();};
                if let Some(retry)=super::source_retry::cutter_at_precision(cutter,&mesh,self.precision_frame.unwrap_or(0.),clearance){
                    let (lo,hi)=retry.bounds();*opening=OpeningType::NonRectangular(retry,lo.cast(),hi.cast(),None);
                }
            }
            revised.merged_openings=revised.openings.clone();
            if let Some(result)=self.try_authored_solids(mesh.clone(),&revised,id,false){return result;}
        }
        Mesh::new()
    }
    fn record_authored_result(&self,stock:&Mesh,result:&Mesh,id:u32) {
        if result.is_empty(){self.voids_consumed_hosts.borrow_mut().insert(id);}
        self.record_host_cut_effect(id,stock.triangle_count(),result.triangle_count(),0,world_host_bounds(stock));
    }
    fn try_authored_solids(&self,mut mesh:Mesh,ctx:&VoidContext,id:u32,repair_one:bool)->Option<Mesh> {
        let before=mesh.triangle_count();let bounds=world_host_bounds(&mesh);
        let groups=super::source_batch::groups(ctx);
        let mut tried=vec![false;groups.len()];let mut consumed=vec![false;ctx.openings.len()];
        for (stage,opening) in ctx.openings.iter().enumerate() {
            if consumed[stage]{continue;}
            if let Some((group_index,group))=groups.iter().enumerate().find(|(_,group)|group.len()>1 && group.contains(&stage)){
                if !tried[group_index] {
                    tried[group_index]=true;
                    let cutters=group.iter().filter_map(|&index|if let OpeningType::NonRectangular(cutter,..)=&ctx.openings[index]{Some(cutter)}else{None}).collect::<Vec<_>>();
                    if let Some(result)=self.try_authored_group(&mesh,&cutters){
                        for &index in group{consumed[index]=true;}mesh=result;
                        if mesh.is_empty(){break;}continue;
                    }
                }
            }
            let OpeningType::NonRectangular(cutter,..)=opening else {return None;};
            if cutter.is_empty() {return None;}
            let (lo,hi)=mesh.bounds();let (clo,chi)=cutter.bounds();
            if (0..3).any(|i|chi[i]<lo[i] || clo[i]>hi[i]) {continue;}
            let result=self.cut_authored_one(&mesh,opening).or_else(||{
                if !repair_one{return None;}
                for clearance in [2.,4.,8.,12.] {
                    let Some(revised)=super::source_retry::cutter_at_precision(cutter,&mesh,self.precision_frame.unwrap_or(0.),clearance) else {continue;};
                    let (a,b)=revised.bounds();
                    let candidate=OpeningType::NonRectangular(revised,a.cast(),b.cast(),None);
                    if let Some(result)=self.cut_authored_one(&mesh,&candidate) {return Some(result);}
                }
                None
            });
            let result=result?;
            mesh=result;if mesh.is_empty(){break;}
        }
        if mesh.is_empty(){self.voids_consumed_hosts.borrow_mut().insert(id);}
        self.record_host_cut_effect(id,before,mesh.triangle_count(),0,bounds);
        Some(mesh)
    }
    fn cut_authored_one(&self,stock:&Mesh,opening:&OpeningType)->Option<Mesh> {
        let precision=self.precision_frame?;
        let OpeningType::NonRectangular(cutter,..)=opening else{return None;};
        let sensitive=super::source_retry::has_resolvable_skin(stock,cutter);
        let clipper=ClippingProcessor::new();
        let analytic=super::source_plane::cut_boundary_plane(stock,cutter,&clipper,precision)
            .or_else(||super::convex_cut::cut(stock,cutter,&clipper,precision));
        if let Some(raw)=analytic {
            if let Some(result)=self.finish_authored_mesh(stock,raw,precision){return Some(result);}
        }
        for scale in [256.,16.] {
        let scaled=super::source_retry::scaled(stock,scale);
        let scaled_cutter=super::source_retry::scaled(cutter,scale);
        let (lo,hi)=scaled_cutter.bounds();
        let scaled_opening=OpeningType::NonRectangular(scaled_cutter,lo.cast(),hi.cast(),None);
        if let Some(result)=self.cut_authored_in_frame(&scaled,&scaled_opening,precision*scale) {
            let mut restored=super::source_retry::scaled(&result,1./scale);
            super::source_hygiene::clean(&mut restored);
            if precision_seams::close_with_precision(&mut restored,precision){return Some(restored);}
        }
        }
        if sensitive{return None;}
        if let Some(result)=self.cut_authored_in_frame(stock,opening,precision){return Some(result);}
        let h=crate::kernel::mesh_bridge::SNAP_GRID*0.5;
        for delta in [[h,h,h],[h,0.,0.],[0.,h,0.],[0.,0.,h]] {
            let shifted=super::source_retry::translated(stock,delta);
            let shifted_cutter=super::source_retry::translated(cutter,delta);
            let (lo,hi)=shifted_cutter.bounds();
            let shifted_opening=OpeningType::NonRectangular(shifted_cutter,lo.cast(),hi.cast(),None);
            if let Some(result)=self.cut_authored_in_frame(&shifted,&shifted_opening,precision){
                let mut restored=super::source_retry::translated(&result,delta.map(|v|-v));
                super::source_hygiene::clean(&mut restored);
                if precision_seams::close_with_precision(&mut restored,self.precision_frame?){return Some(restored);}
            }
        }
        None
    }
    fn cut_authored_in_frame(&self,stock:&Mesh,opening:&OpeningType,precision:f64)->Option<Mesh> {
        let OpeningType::NonRectangular(cutter,..)=opening else {return None;};
        let clipper=ClippingProcessor::new();
        let next=super::source_plane::cut_boundary_plane(stock,cutter,&clipper,precision)
            .or_else(||super::convex_cut::cut(stock,cutter,&clipper,precision))
            .or_else(||clipper.subtract_source_mesh(stock,cutter))?;
        if let Some(result)=self.finish_authored_mesh(stock,next,precision){return Some(result);}
        if !super::prism_cut::enabled(){return None;}
        let single=VoidContext {openings:vec![opening.clone()],merged_openings:vec![opening.clone()],param:None,bool2d:None};
        let (result,residual)=self.try_prism_cut(stock,&single)?;
        if residual.is_some(){return None;}
        self.finish_authored_mesh(stock,result,precision)
    }
    pub(super) fn finish_authored_mesh(&self,stock:&Mesh,mut next:Mesh,precision:f64)->Option<Mesh> {
        if next.is_empty(){return Some(next);}
        let clipper=ClippingProcessor::new();
        let pristine=next.clone();
        super::source_hygiene::clean(&mut next);
        let raw_closed=precision_seams::close_with_precision(&mut next,precision);
        let volume=enclosed_volume(&next).abs();
        let mut consolidated=clipper.consolidate(pristine);
        super::source_hygiene::clean(&mut consolidated);
        let consolidated_closed=precision_seams::close_with_precision(&mut consolidated,precision);
        let chosen=if consolidated_closed && (!raw_closed || (enclosed_volume(&consolidated).abs()-volume).abs()<=volume*1e-5) {
            consolidated
        }else if raw_closed {next}else{return None;};
        let (lo,hi)=stock.bounds();let (nlo,nhi)=chosen.bounds();
        let grid=crate::kernel::mesh_bridge::SNAP_GRID;
        if (0..3).any(|i|f64::from(nlo[i])<f64::from(lo[i])-2.*grid || f64::from(nhi[i])>f64::from(hi[i])+2.*grid){return None;}
        let span=(hi-lo).map(f64::from);
        let envelope=2.*(span.x*span.y+span.y*span.z+span.z*span.x)*grid;
        if enclosed_volume(&chosen).abs()>enclosed_volume(stock).abs()+envelope{return None;}
        Some(chosen)
    }
}
