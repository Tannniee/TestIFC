// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Close the hairline T-junction seams an accepted analytic cut can keep (#5739).
//!
//! The emit gate accepts a cut whose unmatched edges are covered collinearly by
//! reverse edges: two faces subdividing one boundary line differently. On a
//! plan-rotated wall stored in a per-element local frame, up to 64 such edges
//! survived: vertices a few world f32 ulps apart that the cut's weld, sized by
//! the small stored coordinates, left unmerged, plus T-junctions along the
//! seam. This pass re-welds at the world quantum, then splits each open edge
//! at the open-edge endpoints that lie on it, which makes the two subdivisions
//! agree. It adds no vertices. It is attempted only on a cut that is still
//! open, and kept only if it closes that cut strictly with its volume kept.

use super::super::frame_snap::closed_and_consistently_wound;
use super::super::geom::mesh_signed_volume;
use super::vertex_dedup::{dedup_cut_vertices_within, weld_tolerance};
use super::Mesh;
use rustc_hash::FxHashMap;

type Key = [i64; 3];

/// The 0.1 mm lattice the closure audits key on.
fn key(p: [f64; 3]) -> Key {
    p.map(|c| (c * 1.0e4).round() as i64)
}

/// `cut` re-welded at the world quantum and with its T-junctions split, or
/// `None` when that does not leave it strictly closed with its volume kept.
pub(super) fn close_seams(cut: &Mesh, host: &Mesh) -> Option<Mesh> {
    let welded = dedup_cut_vertices_within(cut, host, true);
    let tol = weld_tolerance(&welded, host, &vec![true; welded.positions.len() / 3], true);
    let closed = close_t_junctions(&welded, tol)?;
    // The split moves nothing; the weld moves each vertex by at most `tol`, so
    // the enclosed volume can move by at most `tol` times the surface area.
    let (before, after) = (mesh_signed_volume(cut), mesh_signed_volume(&closed));
    ((after - before).abs() <= tol * surface_area(cut)).then_some(closed)
}

/// `cut` with its open edges split at the collinear open-edge endpoints within
/// `tol`, or `None` when that does not leave it strictly closed.
fn close_t_junctions(cut:&Mesh,tol:f64)->Option<Mesh> {
    close_t_junctions_impl(cut,tol,key,closed_and_consistently_wound,false,usize::MAX)
}

/// Exact stored-key variant for source-frame CSG. Boundary subdivisions alone
/// are changed; real missing faces do not supply collinear endpoints and fail.
pub(in crate::router::voids) fn close_exact(cut:&Mesh,tol:f64)->Option<Mesh> {
    close_t_junctions_impl(cut,tol,|p|p.map(|v|if v==0. {0}else{(v as f32).to_bits()}),
        super::super::precision_seams::closed_manifold,true,16_000_000)
}

fn close_t_junctions_impl<K: Copy+Eq+std::hash::Hash>(cut: &Mesh, tol: f64, key: impl Fn([f64;3])->K,
    accept: impl Fn(&Mesh)->bool, allow_center:bool, budget:usize) -> Option<Mesh> {
    let vc = cut.positions.len() / 3;
    let pos = |i: u32| -> [f64; 3] {
        let b = i as usize * 3;
        [cut.positions[b] as f64, cut.positions[b + 1] as f64, cut.positions[b + 2] as f64]
    };
    if cut.indices.iter().any(|&i| i as usize >= vc) {
        return None;
    }
    let mut balance: FxHashMap<(K, K), i64> = FxHashMap::default();
    for t in cut.indices.chunks_exact(3) {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            let (ka, kb) = (key(pos(a)), key(pos(b)));
            if ka != kb {
                *balance.entry((ka, kb)).or_insert(0) += 1;
                *balance.entry((kb, ka)).or_insert(0) -= 1;
            }
        }
    }
    let open = |a: u32, b: u32| {
        let (ka, kb) = (key(pos(a)), key(pos(b)));
        ka != kb && balance.get(&(ka, kb)).is_some_and(|&c| c != 0)
    };
    // Candidate split points: every endpoint of an open edge, in index order.
    let mut candidates: Vec<u32> = Vec::new();
    for t in cut.indices.chunks_exact(3) {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            if open(a, b) {
                candidates.extend([a, b]);
            }
        }
    }
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_unstable();
    candidates.dedup();

    let mut closed = cut.clone();
    let mut work=0_usize;
    let mut indices = Vec::with_capacity(cut.indices.len() + 16);
    let mut changed = false;
    for t in cut.indices.chunks_exact(3) {
        let mut ring: Vec<u32> = Vec::with_capacity(6);
        let mut split_edges = [false; 3];
        for (e, (a, b)) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])].into_iter().enumerate() {
            ring.push(a);
            if !open(a, b) {
                continue;
            }
            let (pa, pb) = (pos(a), pos(b));
            let (ka, kb) = (key(pa), key(pb));
            let ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
            let len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
            let len = len2.sqrt();
            let mut hits: Vec<(f64, u32)> = Vec::new();
            for &q in &candidates {
                if work>=budget { return None; }
                work+=1;
                let pq = pos(q);
                let kq = key(pq);
                if kq == ka || kq == kb {
                    continue;
                }
                let aq = [pq[0] - pa[0], pq[1] - pa[1], pq[2] - pa[2]];
                let s = (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / len2;
                // Source keys distinguish real short boundary segments. The
                // metric tolerance bounds distance TO the edge, not distance
                // along it; treating a near-endpoint as the endpoint loses a
                // finite thin-skin subdivision. Keep the import path unchanged.
                let outside=if allow_center {s<=0. || s>=1.}else{s*len<=tol || (1.-s)*len<=tol};
                if outside {
                    continue;
                }
                let off = [pa[0] + s * ab[0] - pq[0], pa[1] + s * ab[1] - pq[1], pa[2] + s * ab[2] - pq[2]];
                if off[0] * off[0] + off[1] * off[1] + off[2] * off[2] > tol * tol {
                    continue;
                }
                hits.push((s, q));
            }
            // Deterministic: by position along the edge, then by index.
            hits.sort_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)));
            hits.dedup_by(|x, y| key(pos(x.1)) == key(pos(y.1)));
            if !hits.is_empty() {
                split_edges[e] = true;
                ring.extend(hits.into_iter().map(|(_, q)| q));
            }
        }
        if !split_edges.contains(&true) {
            indices.extend_from_slice(t);
            continue;
        }
        // Fan from the corner whose two incident edges are both unsplit: every
        // fan triangle then spans a split edge's sub-segment and that corner, so
        // none is degenerate. Two or more split edges have no such corner.
        let apex_corner = (0..3).find(|&c| !split_edges[c] && !split_edges[(c + 2) % 3]);
        let apex = apex_corner.and_then(|c|ring.iter().position(|&v|v==t[c]));
        if apex.is_none() && !allow_center { return None; }
        if allow_center {
            let raw=(0..3).map(|i|nalgebra::Vector3::from(pos(t[i]))).collect::<Vec<_>>();
            let normal=(raw[1]-raw[0]).cross(&(raw[2]-raw[0])).try_normalize(1e-15)?;
            for vertex in &mut ring {
                let point=pos(*vertex);
                *vertex=(closed.positions.len()/3) as u32;
                closed.positions.extend(point.map(|v|v as f32));
                closed.normals.extend([normal.x as f32,normal.y as f32,normal.z as f32]);
            }
            if let Some(apex)=apex {
                for k in 1..ring.len()-1 {
                    indices.extend_from_slice(&[ring[apex],ring[(apex+k)%ring.len()],ring[(apex+k+1)%ring.len()]]);
                }
            } else {
                let center=(raw[0]+raw[1]+raw[2])/3.;
                let index=(closed.positions.len()/3) as u32;
                closed.positions.extend([center.x as f32,center.y as f32,center.z as f32]);
                closed.normals.extend([normal.x as f32,normal.y as f32,normal.z as f32]);
                for k in 0..ring.len() { indices.extend_from_slice(&[index,ring[k],ring[(k+1)%ring.len()]]); }
            }
        }else{
            let apex=apex?;
            for k in 1..ring.len()-1 {
                indices.extend_from_slice(&[ring[apex],ring[(apex+k)%ring.len()],ring[(apex+k+1)%ring.len()]]);
            }
        }
        changed = true;
    }
    if !changed {
        return None;
    }
    closed.indices = indices;
    // Per-triangle plane tags no longer line up with the new index buffer.
    closed.plane_tags = None;
    accept(&closed).then_some(closed)
}

fn surface_area(mesh: &Mesh) -> f64 {
    let p = |i: u32| {
        let b = i as usize * 3;
        [mesh.positions[b] as f64, mesh.positions[b + 1] as f64, mesh.positions[b + 2] as f64]
    };
    mesh.indices
        .chunks_exact(3)
        .map(|t| {
            let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
            let (u, v) = ([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            0.5 * (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt()
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{Point3, Vector3};

    /// A tetrahedron whose face A-B-D is split at M, the midpoint of A-B, while
    /// the face across A-B is not: one T-junction, 2 open directed edges.
    fn t_junction_tetrahedron(far: f64) -> Mesh {
        let mut mesh = Mesh::new();
        let (a, b, c, d) = ([far, 0.0, 0.0], [far + 1.0, 0.0, 0.0], [far, 1.0, 0.0], [far, 0.0, 1.0]);
        let m = [far + 0.5, 0.0, 0.0];
        for p in [a, b, c, d, m] {
            mesh.add_vertex(Point3::new(p[0], p[1], p[2]), Vector3::zeros());
        }
        let (a, b, c, d, m) = (0, 1, 2, 3, 4);
        for t in [[a, c, b], [a, m, d], [m, b, d], [b, c, d], [a, d, c]] {
            mesh.add_triangle(t[0], t[1], t[2]);
        }
        mesh
    }

    #[test]
    fn nhip_exact_seam_keeps_a_finite_segment_shorter_than_repair_tolerance() {
        let mut cut=t_junction_tetrahedron(0.0);
        cut.positions[12]=1e-7;
        assert!(!super::super::super::precision_seams::closed_manifold(&cut));
        let closed=close_exact(&cut,1e-5).expect("a distinct interior endpoint must split the long edge");
        assert!(super::super::super::precision_seams::closed_manifold(&closed));
        assert!(closed.positions.as_chunks::<3>().0.iter().any(|p|p[0]==1e-7));
    }

    #[test]
    fn t_junction_is_split_and_the_cut_closes_5739() {
        let cut = t_junction_tetrahedron(0.0);
        assert!(!closed_and_consistently_wound(&cut), "premise: the T-junction leaves it open");
        let closed = close_seams(&cut, &cut).expect("the seam closes");
        assert!(closed_and_consistently_wound(&closed));
        assert_eq!(closed.positions, cut.positions, "no vertex moves or is added");
        assert_eq!(closed.triangle_count(), cut.triangle_count() + 1);
    }

    #[test]
    fn a_missing_face_is_not_papered_over_5739() {
        let mut cut = t_junction_tetrahedron(0.0);
        cut.indices.truncate(cut.indices.len() - 3);
        assert!(close_seams(&cut, &cut).is_none(), "a hole is not a seam");
    }
}
