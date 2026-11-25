use super::*;

fn seam(offset:f32)->Mesh {
    let mut mesh=Mesh::new();
    mesh.positions=vec![0.,0.,0., 1.,0.,0., 1.,1.,0., 0.,1.,0.,
        0.,0.,1., 1.,0.,1., 1.,1.,1., 0.,1.,1., 0.5,offset,1.];
    // The top face uses AB+BC; its neighbour still uses the long AC edge.
    mesh.indices=vec![0,3,2,0,2,1, 4,8,6,8,5,6,4,6,7, 0,1,5,0,5,4,
        1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7];
    crate::calculate_normals(&mut mesh);
    mesh
}

#[test]
fn nhip_subgrid_seam_conforms_without_retaining_a_degenerate_face() {
    let mut mesh=seam(0.);
    assert!(!closed_manifold(&mesh));
    assert!(conform_subgrid_seams(&mut mesh,0.0002));
    assert!(closed_manifold(&mesh));
    let kept=mesh.indices.clone();
    mesh.clean_degenerate();
    assert_eq!(mesh.indices,kept,"ordinary hygiene must remain idempotent");
    assert!(closed_manifold(&mesh));
    assert!((super::super::frame_snap::enclosed_volume(&mesh).abs()-1.).abs()<1e-8);
}

#[test]
fn nhip_real_triangle_hole_and_strict_precision_are_never_filled() {
    let mut mesh=seam(0.0001);
    let original=mesh.indices.clone();
    assert!(!conform_subgrid_seams(&mut mesh,0.0002));
    assert_eq!(mesh.indices,original,"a real gap cannot be patched speculatively");
    let mut mesh=seam(0.);
    assert!(!conform_subgrid_seams(&mut mesh,1e-6));
}

#[test]
fn nhip_ulp_seam_closes_with_bounded_motion_but_a_real_gap_is_preserved() {
    for (delta,expected) in [(0.0000004_f32,true),(0.0001,false)] {
        let mut mesh=seam(0.);
        assert!(conform_subgrid_seams(&mut mesh,0.0002));
        let i=mesh.indices[0] as usize;
        let mut p=mesh.positions[i*3..i*3+3].to_vec(); p[0]+=delta;
        mesh.indices[0]=(mesh.positions.len()/3) as u32;
        mesh.positions.extend(p);
        mesh.normals.extend([0.,0.,-1.]);
        let original=mesh.positions.clone();
        assert!(!closed_manifold(&mesh));
        assert_eq!(close_with_precision(&mut mesh,0.0002),expected);
        if expected {
            assert!(closed_manifold(&mesh));
            assert!((frame_snap_volume(&mesh)-1.).abs()<1e-7);
            mesh.clean_degenerate(); assert!(closed_manifold(&mesh));
        }else{assert_eq!(mesh.positions,original);}
    }
}

fn frame_snap_volume(mesh:&Mesh)->f64 { super::super::frame_snap::enclosed_volume(mesh).abs() }

#[test]
fn nhip_exact_subdivision_preserves_the_receiving_faces_sharp_normals() {
    let [a,b,c,d,m]=[[0.,0.,0.],[1.,0.,0.],[0.,1.,0.],[0.,0.,1.],[1e-7,0.,0.]].map(Vector3::from);
    let mut mesh=Mesh::new();
    for [a,b,c] in [[a,c,b],[a,m,d],[m,b,d],[b,c,d],[a,d,c]] {
        let normal=(b-a).cross(&(c-a)).normalize();
        let i=mesh.vertex_count() as u32;
        for p in [a,b,c]{mesh.add_vertex(crate::Point3::from(p),normal);}
        mesh.indices.extend([i,i+1,i+2]);
    }
    let closed=crate::conform_exact_boundary(&mesh).expect("exact T junction closes");
    assert!(closed_manifold(&closed));
    for tri in closed.indices.as_chunks::<3>().0 {
        let [a,b,c]=tri.map(|i|point(&closed,i));
        let normal=(b-a).cross(&(c-a)).normalize();
        for i in tri {
            let start=*i as usize*3;
            let stored=Vector3::new(f64::from(closed.normals[start]),f64::from(closed.normals[start+1]),f64::from(closed.normals[start+2]));
            assert!(normal.dot(&stored)>0.999,"an endpoint from another face cannot supply its normal");
        }
    }
}

#[test]
fn nhip_exact_boundary_reuses_short_collinear_endpoints_without_new_geometric_points() {
    let mut mesh=seam(0.);
    mesh.positions[24]=1e-7;
    mesh.positions.extend([0.75,0.,1.]);
    mesh.normals.extend([0.,0.,1.]);
    mesh.indices.splice(6..15,[4,8,6,8,9,6,9,5,6,4,6,7]);
    let closed=crate::conform_exact_boundary(&mesh).expect("finite edge chain conforms");
    assert!(closed_manifold(&closed));
    assert!(closed.positions.as_chunks::<3>().0.iter().all(|p|mesh.positions.as_chunks::<3>().0.contains(p)),"exact subdivision cannot move or invent a geometric point");
    assert!((frame_snap_volume(&closed)-1.).abs()<1e-8);
    mesh.indices.drain(0..3);
    assert!(crate::conform_exact_boundary(&mesh).is_none(),"a missing surface has no collinear counterpart");
}

#[test]
fn nhip_long_boundary_subdivision_conforms_without_capping_a_missing_face() {
    let mut mesh=seam(0.);
    mesh.positions[24]=0.25;
    mesh.positions.extend([0.75,0.,1.]);
    mesh.normals.extend([0.,0.,1.]);
    mesh.indices.splice(6..15,[4,8,6,8,9,6,9,5,6,4,6,7]);
    assert!(!closed_manifold(&mesh));
    assert!(!conform_subgrid_seams(&mut mesh,0.0002),"four-edge chain needs subdivision, not a triangle patch");
    let mut closed=super::super::prism_cut::close_exact(&mesh,1e-6).expect("opposite subdivisions of one edge");
    closed.clean_degenerate_watertight(); closed.clean_degenerate();
    assert!(closed_manifold(&closed));
    assert!((frame_snap_volume(&closed)-1.).abs()<1e-8);
    closed.clean_degenerate(); assert!(closed_manifold(&closed));
    mesh.indices.drain(0..3);
    assert!(super::super::prism_cut::close_exact(&mesh,1e-6).is_none(),"a missing face is not an edge subdivision");
}
