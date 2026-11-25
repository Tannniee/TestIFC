// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! A localized canonical retry must not retain stock inside a real cutter.
//! Sample convex cutters at the stock midplane, strictly beyond Precision
//! from every cutter face; ambiguous boundary rays never prove a filled hole.
use super::{GeometryRouter,source_frame::Output,source_plane};
use crate::{Mesh,Vector3};
use ifc_lite_core::{DecodedEntity,EntityDecoder};

pub(super) fn excludes_cutters<T:Output>(router:&GeometryRouter,element:&DecodedEntity,ids:&[u32],output:&mut T,decoder:&mut EntityDecoder,precision:f64)->bool {
    let Ok(parts)=router.process_element_parts(element,decoder) else{return false;};
    let mut stock=Mesh::new();for part in parts{stock.merge(&part);}
    let mut cut=Mesh::new();for part in output.meshes(){cut.merge(part);}
    let (lo,hi)=stock.bounds();let span=hi-lo;
    let axis=(0..3).min_by(|&a,&b|span[a].total_cmp(&span[b])).unwrap_or(2);
    let mid=f64::from((lo[axis]+hi[axis])*0.5)+stock.origin[axis];
    let mut work=0_usize;
    for &id in ids {
        let Ok(opening)=decoder.decode_by_id(id) else{return false;};
        let Ok(cutters)=router.process_element_parts(&opening,decoder) else{return false;};
        for cutter in cutters {
            if super::source_retry::has_resolvable_skin(&stock,&cutter){return false;}
            let Some((planes,_))=source_plane::convex_planes(&cutter,precision) else{return false;};
            for tri in cutter.indices.as_chunks::<3>().0 {
                let mut p=tri.map(|i|point(&cutter,i)).into_iter().sum::<Vector3<f64>>()/3.;p[axis]=mid;
                let local=p-Vector3::from(cutter.origin);
                if planes.iter().any(|(n,d)|n.dot(&local)-d>=-precision){continue;}
                if inside(&stock,p,axis,&mut work)==Some(true) && inside(&cut,p,axis,&mut work)==Some(true){return false;}
                if work>16_000_000{return false;}
            }
        }
    }
    true
}

fn point(mesh:&Mesh,index:u32)->Vector3<f64> {
    let i=index as usize*3;
    Vector3::new(f64::from(mesh.positions[i])+mesh.origin[0],f64::from(mesh.positions[i+1])+mesh.origin[1],f64::from(mesh.positions[i+2])+mesh.origin[2])
}

fn inside(mesh:&Mesh,p:Vector3<f64>,axis:usize,work:&mut usize)->Option<bool> {
    let (u,v)=((axis+1)%3,(axis+2)%3);let mut count=0;
    for tri in mesh.indices.as_chunks::<3>().0 {
        *work+=1;if *work>16_000_000{return None;}
        let [a,b,c]=tri.map(|i|point(mesh,i));let ab=b-a;let ac=c-a;let ap=p-a;
        let det=ab[u]*ac[v]-ab[v]*ac[u];if det.abs()<1e-20{continue;}
        let s=(ap[u]*ac[v]-ap[v]*ac[u])/det;let t=(ab[u]*ap[v]-ab[v]*ap[u])/det;
        if s< -1e-9 || t< -1e-9 || s+t>1.+1e-9{continue;}
        let hit=a[axis]+s*ab[axis]+t*ac[axis];
        if (hit-p[axis]).abs()<1e-8{return None;}
        if hit<=p[axis]{continue;}
        if s.abs()<1e-9 || t.abs()<1e-9 || (1.-s-t).abs()<1e-9{return None;}
        count+=1;
    }
    Some(count%2==1)
}
