// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Subdivide exact collinear boundary chains after f32 emission. Every split
//! reuses an existing endpoint coordinate and preserves each incident triangle's
//! winding. Attribute vertices stay separate across sharp normal seams.
//! No centre fan, positional weld, new geometric point or missing-face cap.
use crate::Mesh;
use std::collections::BTreeMap;

type Key=[u32;3];
type Edge=(Key,Key);
fn key(mesh:&Mesh,index:u32)->Key {
    let i=index as usize*3;
    std::array::from_fn(|axis|{let v=mesh.positions[i+axis];if v==0.{0}else{v.to_bits()}})
}
fn point(p:Key)->[f64;3] {p.map(|v|f64::from(f32::from_bits(v)))}
fn edge(a:Key,b:Key)->(Edge,i32) {if a<b{((a,b),1)}else{((b,a),-1)}}

/// Conform opposite, exactly collinear boundary subdivisions without moving
/// geometric points. New attribute vertices interpolate the receiving edge's
/// normals rather than borrowing another face's normal. Returns `None` for a
/// missing/nonmanifold surface or an exhausted bounded repair; input is intact.
pub fn conform_exact_boundary(mesh:&Mesh)->Option<Mesh> {
    if !mesh.positions.len().is_multiple_of(3) || !mesh.indices.len().is_multiple_of(3)
        || mesh.positions.iter().any(|v|!v.is_finite()) || mesh.indices.iter().any(|&i|i as usize>=mesh.positions.len()/3){return None;}
    let mut candidate=mesh.clone();
    let mut work=0_usize;
    for _ in 0..512 {
        let mut edges=BTreeMap::<Edge,(usize,i32)>::new();
        let mut endpoints=BTreeMap::<Key,u32>::new();
        for tri in candidate.indices.as_chunks::<3>().0 {
            work+=1;if work>16_000_000{return None;}
            let keys=tri.map(|i|key(&candidate,i));
            for i in 0..3 {
                endpoints.entry(keys[i]).or_insert(tri[i]);
                let (e,sense)=edge(keys[i],keys[(i+1)%3]);
                let value=edges.entry(e).or_default();value.0+=1;value.1+=sense;
            }
        }
        edges.retain(|_,uses|*uses!=(2,0));
        if edges.is_empty(){
            let finite_faces=!candidate.indices.is_empty() && candidate.indices.as_chunks::<3>().0.iter().all(|tri|{
                let [a,b,c]=tri.map(|i|crate::Vector3::from(point(key(&candidate,i))));
                (b-a).cross(&(c-a)).norm_squared()>0.
            });
            return finite_faces.then_some(candidate);
        }
        if edges.len()>512{return None;}
        let endpoints=edges.keys().flat_map(|&(a,b)|[a,b]).filter_map(|p|endpoints.get(&p).map(|&i|(p,i))).collect::<BTreeMap<_,_>>();
        let mut split=None;
        'search:for &(a,b) in edges.keys() {
            let (pa,pb)=(point(a),point(b));
            let ab=std::array::from_fn::<_,3,_>(|i|pb[i]-pa[i]);
            let length=ab.iter().map(|v|v*v).sum::<f64>();
            for (&p,&index) in &endpoints {
                work+=1;if work>16_000_000{return None;}
                let pp=point(p);let ap=std::array::from_fn::<_,3,_>(|i|pp[i]-pa[i]);
                let along=ap.iter().zip(ab).map(|(a,b)|a*b).sum::<f64>();
                if along<=0. || along>=length {continue;}
                let cross=[ap[1]*ab[2]-ap[2]*ab[1],ap[2]*ab[0]-ap[0]*ab[2],ap[0]*ab[1]-ap[1]*ab[0]];
                if cross.iter().all(|v|*v==0.){split=Some(((a,b),index));break 'search;}
            }
        }
        let (target,vertex)=split?;
        let mut indices=Vec::with_capacity(candidate.indices.len()+6);
        let mut changed=false;
        let triangles=std::mem::take(&mut candidate.indices);
        let has_normals=candidate.normals.len()==candidate.positions.len();
        for tri in triangles.as_chunks::<3>().0 {
            work+=1;if work>16_000_000{return None;}
            if let Some(i)=(0..3).find(|&i|edge(key(&candidate,tri[i]),key(&candidate,tri[(i+1)%3])).0==target) {
                let (a,b,c)=(tri[i],tri[(i+1)%3],tri[(i+2)%3]);
                let pa=crate::Vector3::from(point(key(&candidate,a)));
                let pb=crate::Vector3::from(point(key(&candidate,b)));
                let p=crate::Vector3::from(point(key(&candidate,vertex)));
                let ab=pb-pa;let fraction=(p-pa).dot(&ab)/ab.norm_squared();
                let start=vertex as usize*3;
                let coordinate=*candidate.positions[start..start+3].first_chunk::<3>()?;
                let index=u32::try_from(candidate.positions.len()/3).ok()?;
                if has_normals {
                    let normal=|i:u32|{let j=i as usize*3;crate::Vector3::new(f64::from(candidate.normals[j]),f64::from(candidate.normals[j+1]),f64::from(candidate.normals[j+2]))};
                    let n=(normal(a)*(1.-fraction)+normal(b)*fraction).try_normalize(0.)?;
                    candidate.normals.extend([n.x as f32,n.y as f32,n.z as f32]);
                }
                candidate.positions.extend(coordinate);
                indices.extend([a,index,c,index,b,c]);changed=true;
            }else{indices.extend(tri);}
        }
        if !changed{return None;}
        candidate.indices=indices;candidate.plane_tags=None;
    }
    None
}
