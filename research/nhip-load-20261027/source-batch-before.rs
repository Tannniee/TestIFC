// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Use the canonical N-ary kernel for disjoint finite manufacturing cutters.
//! No penetration extension, minimum opening volume or bounding-box cutter.
use super::{GeometryRouter,OpeningType,VoidContext,disjoint_groups,precision_seams,source_retry};
use crate::{csg::ClippingProcessor,Mesh};
pub(super) fn groups(ctx:&VoidContext)->Vec<Vec<usize>> {
    let mut bounds=Vec::new();
    for opening in &ctx.openings {
        let OpeningType::NonRectangular(mesh,..)=opening else{return Vec::new();};
        let (lo,hi)=mesh.bounds();
        bounds.push((std::array::from_fn(|i|f64::from(lo[i])+mesh.origin[i]-disjoint_groups::PAD),
            std::array::from_fn(|i|f64::from(hi[i])+mesh.origin[i]+disjoint_groups::PAD)));
    }
    disjoint_groups::partition(&bounds)
}
impl GeometryRouter {
    pub(super) fn try_authored_all(&self,stock:&Mesh,ctx:&VoidContext)->Option<Mesh> {
        let mut cutters=ctx.openings.iter().map(|opening|if let OpeningType::NonRectangular(mesh,..)=opening{Some(mesh)}else{None}).collect::<Option<Vec<_>>>()?;
        if cutters.len()<2{return None;}
        if groups(ctx).iter().any(|group|group.len()==cutters.len()) {
            // Independent components commute. Pack the small components first
            // so one detailed outline does not split their common arrangement
            // into repeated f32 round trips. Overlapping cutters keep file order.
            cutters.sort_by_key(|mesh|mesh.triangle_count());
        }
        let mut result=stock.clone();
        let mut start=0;
        while start<cutters.len() {
            let mut end=start;let mut triangles=0;
            while end<cutters.len() && end-start<crate::csg::MAX_CUTTERS_PER_ARRANGEMENT {
                let next=cutters[end].triangle_count();
                if next>2048 || triangles+next>2048{break;}
                triangles+=next;end+=1;
            }
            if end==start{return None;}
            result=self.try_authored_group(&result,&cutters[start..end])?;
            if result.is_empty(){return Some(result);}
            start=end;
        }
        Some(result)
    }
    pub(super) fn try_authored_group(&self,stock:&Mesh,cutters:&[&Mesh])->Option<Mesh> {
        if cutters.iter().any(|mesh|!precision_seams::closed_manifold(mesh)){return None;}
        let precision=self.precision_frame?;
        let sensitive=cutters.iter().any(|cutter|source_retry::has_resolvable_skin(stock,cutter));
        for scale in [256.,16.,1.] {
            if sensitive && scale==1.{continue;}
            let host=source_retry::scaled(stock,scale);
            let meshes=cutters.iter().map(|cutter|source_retry::scaled(cutter,scale)).collect::<Vec<_>>();
            let refs=meshes.iter().collect::<Vec<_>>();
            let clipper=ClippingProcessor::new();
            let Some(raw)=clipper.subtract_source_meshes(&host,&refs) else{continue;};
            let Some(result)=self.finish_authored_mesh(&host,raw,precision*scale) else{continue;};
            let restored=source_retry::scaled(&result,1./scale);
            if let Some(result)=self.finish_authored_mesh(stock,restored,precision){return Some(result);}
        }
        None
    }
}
