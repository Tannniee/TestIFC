// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Finite convex cut: keep the host skin outside the cutter, then append each
//! cutter-plane reveal clipped by ALL remaining cutter planes. Partition faces
//! are never emitted, so finite wedge ends and blind pocket bottoms stay real.
use super::{precision_seams,source_plane};
use crate::{csg::{ClippingProcessor,Plane},Mesh,Point3,Vector3};

pub(super) fn cut(host:&Mesh,cutter:&Mesh,clipper:&ClippingProcessor,precision:f64)->Option<Mesh> {
    if host.triangle_count()>20_000 || !precision_seams::closed_manifold(host){return None;}
    let (planes,eps)=source_plane::convex_planes(cutter,precision)?;
    if planes.len()>16{return None;}
    let (lo,hi)=host.bounds();
    let corners=(0..8).map(|i|Vector3::new(if i&1==0 {lo.x}else{hi.x} as f64,
        if i&2==0 {lo.y}else{hi.y} as f64,if i&4==0 {lo.z}else{hi.z} as f64)).collect::<Vec<_>>();
    let mut active=Vec::new();
    for &(n,d) in &planes {
        let low=corners.iter().map(|p|n.dot(p)-d).fold(f64::INFINITY,f64::min);
        let high=corners.iter().map(|p|n.dot(p)-d).fold(f64::NEG_INFINITY,f64::max);
        if low>=-eps{return Some(host.clone());}
        if high>eps{active.push((n,d));}
    }
    if active.is_empty(){return Some(Mesh::new());}
    let mut skin=host.clone();let mut result=Mesh::new();
    for &(n,d) in &active {
        if skin.is_empty(){break;}
        let origin=Point3::from(n*d);
        let mut outside=clipper.clip_mesh(&skin,&Plane::new(origin,n)).ok()?;
        remove_covered_coplanar(&mut outside,n,d,eps);
        result.merge(&outside);
        skin=clipper.clip_mesh(&skin,&Plane::new(origin,-n)).ok()?;
    }
    for &(n,d) in &active {
        let origin=Point3::from(n*d);
        let mut clipped=clipper.clip_mesh(host,&Plane::new(origin,n)).ok()?;
        if clipped.is_empty(){continue;}
        let before=clipped.indices.len();
        if !crate::processors::cap_half_space_clip(&mut clipped,origin,n){return None;}
        clipped.indices=clipped.indices[before..].to_vec();
        for &(other,offset) in &planes {
            if n.dot(&other)>1.-1e-12 && (d-offset).abs()<=eps{continue;}
            clipped=clipper.clip_mesh(&clipped,&Plane::new(Point3::from(other*offset),-other)).ok()?;
            if clipped.is_empty(){break;}
        }
        result.merge(&clipped);
    }
    super::source_hygiene::clean(&mut result);
    precision_seams::close_with_precision(&mut result,precision).then_some(result)
}

fn remove_covered_coplanar(mesh:&mut Mesh,n:Vector3<f64>,d:f64,eps:f64) {
    let p=|i:u32|{let b=i as usize*3;Vector3::new(f64::from(mesh.positions[b]),f64::from(mesh.positions[b+1]),f64::from(mesh.positions[b+2]))};
    let indices=mesh.indices.as_chunks::<3>().0.iter().filter(|t|{
        let [a,b,c]=t.map(p);
        !([a,b,c].iter().all(|v|(n.dot(v)-d).abs()<=eps) && (b-a).cross(&(c-a)).dot(&n)>0.)
    }).copied().flatten().collect();
    mesh.indices=indices;mesh.plane_tags=None;
}
