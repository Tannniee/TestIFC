// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A finite convex cutter equals ONE half-space inside the stock only when
//! every other cutter face contains the ENTIRE stock AABB. Prove that before
//! clipping: a bounded wedge or pocket can never become an unbounded plane.
use super::{precision_seams,frame_snap::enclosed_volume};
use crate::{csg::{ClippingProcessor,Plane},Mesh,Point3,Vector3};

pub(super) fn convex_planes(cutter:&Mesh,precision:f64)->Option<(Vec<(Vector3<f64>,f64)>,f64)> {
    if cutter.triangle_count()>128 || !precision_seams::closed_manifold(cutter) { return None; }
    let points=cutter.positions.as_chunks::<3>().0.iter().map(|p|Vector3::new(f64::from(p[0]),f64::from(p[1]),f64::from(p[2]))).collect::<Vec<_>>();
    if points.len().checked_mul(cutter.triangle_count())?>1_000_000 { return None; }
    let magnitude=points.iter().map(Vector3::norm).fold(1.,f64::max);
    // Operand vertices have already narrowed to f32 in this small frame.
    // Bound their plane noise by both the kernel grid and source Precision.
    let eps=(4.*f64::from(f32::EPSILON)*magnitude).min(crate::kernel::mesh_bridge::SNAP_GRID).min(precision*0.25);
    if !eps.is_finite() || eps<=0. { return None; }
    let orientation=if enclosed_volume(cutter)<0. {-1.}else{1.};
    let mut planes=Vec::<(Vector3<f64>,f64)>::new();
    for tri in cutter.indices.as_chunks::<3>().0 {
        let [a,b,c]=tri.map(|i|points[i as usize]);
        let geometric=(b-a).cross(&(c-a)).try_normalize(1e-15)?;
        let normals=tri.map(|i|{let k=i as usize*3;Vector3::new(f64::from(*cutter.normals.get(k)?),f64::from(*cutter.normals.get(k+1)?),f64::from(*cutter.normals.get(k+2)?)).try_normalize(1e-15)});
        let stable=normals[0].filter(|normal|normals.iter().all(|other|other.is_some_and(|value|normal.dot(&value)>1.-1e-10)));
        let n=stable.filter(|normal|[a,b,c].iter().all(|p|normal.dot(&(p-a)).abs()<=eps))
            .map(|normal|if normal.dot(&geometric)<0. {-normal}else{normal}).unwrap_or(geometric)*orientation;
        let d=[a,b,c].iter().map(|p|n.dot(p)).sum::<f64>()/3.;
        if points.iter().any(|p|n.dot(p)-d>eps) { return None; }
        if !planes.iter().any(|(normal,offset)|normal.dot(&n)>1.-1e-12 && (*offset-d).abs()<=eps) { planes.push((n,d)); }
    }
    Some((planes,eps))
}

pub(super) fn cut_boundary_plane(host:&Mesh,cutter:&Mesh,clipper:&ClippingProcessor,precision:f64)->Option<Mesh> {
    let (planes,eps)=convex_planes(cutter,precision)?;
    let (lo,hi)=host.bounds();
    let corners=(0..8).map(|i|Vector3::new(if i&1==0 {lo.x}else{hi.x} as f64,
        if i&2==0 {lo.y}else{hi.y} as f64,if i&4==0 {lo.z}else{hi.z} as f64)).collect::<Vec<_>>();
    let mut active=None;
    for (n,d) in planes {
        let low=corners.iter().map(|p|n.dot(p)-d).fold(f64::INFINITY,f64::min);
        let high=corners.iter().map(|p|n.dot(p)-d).fold(f64::NEG_INFINITY,f64::max);
        if high<=eps { continue; }
        if low>=-eps { return Some(host.clone()); } // convex cutter misses all stock material
        if active.replace((n,d)).is_some() { return None; }
    }
    let Some((normal,d))=active else { return Some(Mesh::new()); }; // proven engulfing cutter
    let point=Point3::from(normal*d);
    let mut result=clipper.clip_mesh(host,&Plane::new(point,normal)).ok()?;
    if result.is_empty() { return Some(result); }
    let skin=result.positions.len();
    if !crate::processors::cap_half_space_clip(&mut result,point,normal) { return None; }
    match_cap_rim(&mut result,skin,&normal,d,precision)?;
    result.clean_degenerate_watertight(); result.clean_degenerate();
    precision_seams::closed_manifold(&result).then_some(result)
}

/// Projection/lifting of a cap can differ from its clipped skin by one f32
/// ULP. Match only those rim copies, with an actual displacement bound and a
/// work cap. Normals remain separate; every resulting edge is checked exactly.
fn match_cap_rim(mesh:&mut Mesh,skin:usize,normal:&Vector3<f64>,d:f64,precision:f64)->Option<()> {
    let cap=mesh.positions.get(skin..)?.as_chunks::<3>().0.to_vec();
    if (skin/3).checked_mul(cap.len())?>1_000_000 { return None; }
    let limit=crate::kernel::mesh_bridge::SNAP_GRID.min(precision*0.25);
    for p in mesh.positions[..skin].as_chunks_mut::<3>().0 {
        let point=Vector3::new(f64::from(p[0]),f64::from(p[1]),f64::from(p[2]));
        if (normal.dot(&point)-d).abs()>2.*limit { continue; }
        let mut best=limit*limit;
        let mut matched=None;
        for q in &cap {
            let delta=point-Vector3::new(f64::from(q[0]),f64::from(q[1]),f64::from(q[2]));
            let distance=delta.norm_squared();
            if distance<=best { best=distance; matched=Some(*q); }
        }
        if let Some(q)=matched { *p=q; }
    }
    Some(())
}
