// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Exact stored-edge census and bounded conformity repair of sub-grid seams.
//! Repairs introduce no retained sub-grid face: ordinary hygiene still runs.
use crate::{Mesh, Vector3};
use rustc_hash::{FxHashMap, FxHashSet};

type Key = [u32; 3];
type Edge = (Key, Key);
type Use = (u32, i32, [u32; 2]);

fn point(mesh: &Mesh, i: u32) -> Vector3<f64> {
    let start = i as usize * 3;
    Vector3::new(f64::from(mesh.positions[start]),f64::from(mesh.positions[start+1]),f64::from(mesh.positions[start+2]))
}

fn census(mesh: &Mesh) -> Option<FxHashMap<Edge, Use>> {
    if mesh.indices.is_empty() || !mesh.indices.len().is_multiple_of(3) || !mesh.positions.len().is_multiple_of(3) { return None; }
    let mut edges = FxHashMap::<Edge, Use>::default();
    for tri in mesh.indices.as_chunks::<3>().0 {
        let mut keys = [[0;3];3];
        for i in 0..3 {
            let start = (tri[i] as usize).checked_mul(3)?;
            let coordinates = mesh.positions.get(start..start.checked_add(3)?)?;
            for axis in 0..3 {
                if !coordinates[axis].is_finite() { return None; }
                keys[i][axis] = if coordinates[axis] == 0.0 { 0 } else { coordinates[axis].to_bits() };
            }
        }
        if (point(mesh,tri[1])-point(mesh,tri[0])).cross(&(point(mesh,tri[2])-point(mesh,tri[0]))).norm_squared() == 0.0 { return None; }
        for i in 0..3 {
            let (a,b) = (keys[i],keys[(i+1)%3]);
            let (edge,sense) = if a < b { ((a,b),1) } else { ((b,a),-1) };
            let value = edges.entry(edge).or_insert((0,0,[tri[i],tri[(i+1)%3]]));
            value.0 += 1; value.1 += sense;
        }
    }
    Some(edges)
}

pub(super) fn boundary_edges(mesh:&Mesh)->Option<Vec<[u32;2]>> {
    let edges=census(mesh)?;
    if edges.values().any(|v|v.0>2 || (v.0==2 && v.1!=0)) { return None; }
    Some(edges.into_values().filter(|v|v.0==1).map(|v|v.2).collect())
}

/// Finite, noncollapsed triangles; every geometric edge has exactly one face
/// in each direction. Signed zeros share a vertex. No positional weld.
pub(super) fn closed_manifold(mesh: &Mesh) -> bool {
    census(mesh).is_some_and(|edges| !edges.is_empty() && edges.values().all(|v|v.0==2 && v.1==0))
}

/// Exact edge-connected boundary components. Unlike the import orienter this
/// cannot weld distinct thin skins or reverse an inner cavity's winding.
pub(super) fn boundary_verdict(mesh:&Mesh)->Option<crate::OrientVerdict> {
    if !closed_manifold(mesh){return None;}
    let triangles=mesh.indices.as_chunks::<3>().0;
    let mut parent=(0..triangles.len()).collect::<Vec<_>>();
    fn root(parent:&mut [usize],mut id:usize)->usize {
        while parent[id]!=id {parent[id]=parent[parent[id]];id=parent[id];} id
    }
    let mut owners=FxHashMap::<Edge,usize>::default();
    for (index,tri) in triangles.iter().enumerate() {
        let keys=tri.map(|i|point(mesh,i).map(|v|if v==0. {0}else{(v as f32).to_bits()}).into());
        for i in 0..3 {
            let (a,b):(Key,Key)=(keys[i],keys[(i+1)%3]);let edge=if a<b{(a,b)}else{(b,a)};
            if let Some(&other)=owners.get(&edge) {
                let a=root(&mut parent,index);let b=root(&mut parent,other);parent[a]=b;
            } else {owners.insert(edge,index);}
        }
    }
    let components=(0..triangles.len()).map(|i|root(&mut parent,i)).collect::<FxHashSet<_>>().len();
    Some(crate::OrientVerdict {flipped:false,all_closed:true,all_orientable:true,components:u32::try_from(components).ok()?})
}

/// A dropped collinear CSG triangle can leave AB+BC opposite AC. Restore only
/// such three-edge seams BELOW the existing kernel grid, then let the existing
/// watertight cleanup conform the long-edge neighbour. No vertex moves, no
/// normal-sized hole is capped, and the ordinary cleanup must be idempotent.
pub(super) fn conform_subgrid_seams(mesh: &mut Mesh, precision: f64) -> bool {
    let grid = crate::kernel::mesh_bridge::SNAP_GRID;
    if !precision.is_finite() || precision*0.25 < grid { return false; }
    let Some(edges) = census(mesh) else { return false; };
    let mut next = FxHashMap::<Key,(Key,[u32;2])>::default();
    for ((a,b),(count,balance,indices)) in edges {
        if count == 2 && balance == 0 { continue; }
        if count != 1 { return false; }
        let (from,to) = if balance==1 { (a,b) } else { (b,a) };
        if next.insert(from,(to,indices)).is_some() { return false; }
    }
    // Bound topology repair independently of file size or number of attempts.
    if next.is_empty() || next.len()>192 || !next.len().is_multiple_of(3) { return false; }
    let mut starts = next.keys().copied().collect::<Vec<_>>(); starts.sort_unstable();
    let mut visited = FxHashSet::default();
    let mut seams = Vec::new();
    for a in starts {
        if visited.contains(&a) { continue; }
        let Some(&(b,ab)) = next.get(&a) else { return false; };
        let Some(&(c,bc)) = next.get(&b) else { return false; };
        if c==a || b==c || next.get(&c).map(|v|v.0)!=Some(a) { return false; }
        if [a,b,c].iter().any(|key|!visited.insert(*key)) { return false; }
        let ids = [ab[0],ab[1],bc[1]];
        let [p,q,r] = ids.map(|i|point(mesh,i));
        let longest = (q-p).norm().max((r-q).norm()).max((p-r).norm());
        let height = (q-p).cross(&(r-p)).norm()/longest;
        if !height.is_finite() || height>=grid { return false; }
        seams.push([ids[0],ids[2],ids[1]]);
    }
    let mut candidate=mesh.clone();
    candidate.plane_tags=None;
    candidate.indices.extend(seams.into_iter().flatten());
    candidate.clean_degenerate_watertight();
    candidate.clean_degenerate();
    if !closed_manifold(&candidate) { return false; }
    *mesh=candidate;
    true
}

/// Reconcile f32 copies of the same seam without merging a kernel-resolvable
/// feature. Reuse the bounded plane-cluster routine; every actual 3D movement
/// must stay below BOTH one kernel grid and Precision/4. Failed attempts leave
/// the mesh intact, and exact edge pairing is still the acceptance predicate.
pub(super) fn close_with_precision(mesh:&mut Mesh,precision:f64)->bool {
    if closed_manifold(mesh) || conform_subgrid_seams(mesh,precision) { return true; }
    // f32 emission can collapse a triangulation-only sliver onto an existing
    // boundary edge. Conform exact subdivisions before any metric cleanup can
    // discard the finite neighbours. Zero tolerance moves no source vertex.
    if let Some(conformed)=crate::conform_exact_boundary(mesh) {
        *mesh=conformed;return true;
    }
    let grid=crate::kernel::mesh_bridge::SNAP_GRID;
    if !precision.is_finite() || precision*0.25<grid { return false; }
    let magnitude=mesh.positions.iter().map(|v|f64::from(v.abs())).fold(1.,f64::max);
    let tolerance=(32.*f64::from(f32::EPSILON)*magnitude).max(grid).min(precision*0.25);
    let mut candidate=mesh.clone();
    super::frame_snap::snap_to_frame_planes(&mut candidate, &mut [], None, tolerance);
    let limit=precision*0.25;
    let within_bound=|a:&Mesh,b:&Mesh|a.positions.as_chunks::<3>().0.iter().zip(b.positions.as_chunks::<3>().0).all(|(a,b)|{
        let distance=a.iter().zip(b).map(|(x,y)|(f64::from(*x)-f64::from(*y)).powi(2)).sum::<f64>().sqrt();
        distance.is_finite() && distance<=limit
    });
    if !within_bound(mesh,&candidate) { candidate=mesh.clone(); }
    candidate.plane_tags=None;
    candidate.clean_degenerate_watertight(); candidate.clean_degenerate();
    if !closed_manifold(&candidate) && !conform_subgrid_seams(&mut candidate,precision) {
        let exact=super::prism_cut::close_exact(&candidate,tolerance).and_then(|mut result|{
            result.clean_degenerate_watertight();result.clean_degenerate();
            closed_manifold(&result).then_some(result)
        });
        let Some(conformed)=exact.or_else(||super::boundary_conform::close(&candidate,limit)) else { return false; };
        candidate=conformed;
    }
    if !within_bound(mesh,&candidate) { return false; }
    *mesh=candidate;
    true
}

#[cfg(test)]
#[path="precision_seams_tests.rs"]
mod tests;
