// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Conform overlapping boundary chains by projecting existing vertices onto
//! existing edges. No missing surface is capped. The entire displacement,
//! including repeated attempts, is bounded by the caller's source precision.
use super::precision_seams::{boundary_edges,closed_manifold};
use crate::{Mesh,Vector3};
use rustc_hash::FxHashMap;

fn point(mesh:&Mesh,index:u32)->Vector3<f64> {
    let i=index as usize*3;
    Vector3::new(f64::from(mesh.positions[i]),f64::from(mesh.positions[i+1]),f64::from(mesh.positions[i+2]))
}
fn key(p:Vector3<f64>)->[u32;3] { p.map(|v|if v==0. {0}else{(v as f32).to_bits()}).into() }

pub(super) fn close(mesh:&Mesh,limit:f64)->Option<Mesh> {
    if !limit.is_finite() || limit<=0. { return None; }
    let mut candidate=mesh.clone();
    let mut work=0_usize;
    for _ in 0..12 {
        let mut edges=boundary_edges(&candidate)?;
        if edges.is_empty() || edges.len()>512 { return None; }
        edges.sort_unstable();
        let mut vertices=edges.iter().flatten().copied().collect::<Vec<_>>();
        vertices.sort_unstable();vertices.dedup();
        let mut targets=FxHashMap::<[u32;3],(f64,Vector3<f64>)>::default();
        for index in vertices {
            let p=point(&candidate,index);let pk=key(p);
            for &[a,b] in &edges {
                work+=1;if work>16_000_000 { return None; }
                let pa=point(&candidate,a);let pb=point(&candidate,b);
                if pk==key(pa) || pk==key(pb) { continue; }
                let delta=pb-pa;let length=delta.norm_squared();
                if length==0. { continue; }
                let fraction=((p-pa).dot(&delta)/length).clamp(0.,1.);
                let projection=pa+delta*fraction;
                let projected=projection.map(|v|f64::from(v as f32));
                let distance=(p-projected).norm_squared();
                if distance==0. || distance>limit*limit || key(projected)==pk { continue; }
                let entry=targets.entry(pk).or_insert((distance,projected));
                if distance<entry.0 { *entry=(distance,projected); }
            }
        }
        if targets.is_empty() { return None; }
        let mut moved=false;
        for (original,p) in mesh.positions.as_chunks::<3>().0.iter().zip(candidate.positions.as_chunks_mut::<3>().0) {
            let pk=p.map(|v|if v==0. {0}else{v.to_bits()});
            if let Some((_,target))=targets.get(&pk) {
                let start=Vector3::new(f64::from(original[0]),f64::from(original[1]),f64::from(original[2]));
                if (*target-start).norm_squared()<=limit*limit {
                    *p=[target.x as f32,target.y as f32,target.z as f32];moved=true;
                }
            }
        }
        if !moved { return None; }
        candidate.plane_tags=None;
        candidate.clean_degenerate_watertight();candidate.clean_degenerate();
        if closed_manifold(&candidate) { return Some(candidate); }
        if let Some(mut conformed)=super::prism_cut::close_exact(&candidate,limit) {
            conformed.clean_degenerate_watertight();conformed.clean_degenerate();
            if closed_manifold(&conformed) { return Some(conformed); }
        }
    }
    None
}
