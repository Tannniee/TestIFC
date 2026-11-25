use super::*;

#[test]
fn nhip_finite_subgrid_bevel_keeps_its_closed_material_boundary() {
    let mut mesh=Mesh::new();
    let d=0.000004_f32;
    let polygon=[[d,0.],[1.,0.],[1.,1.],[0.,1.],[0.,d]];
    for z in [0.,1.] {for p in polygon {mesh.positions.extend([p[0],p[1],z]);}}
    for t in [[0,2,1],[0,3,2],[0,4,3],[5,6,7],[5,7,8],[5,8,9]] {mesh.indices.extend(t);}
    for i in 0..5 {let j=(i+1)%5;mesh.indices.extend([i,j,j+5,i,j+5,i+5]);}
    crate::calculate_normals(&mut mesh);
    assert!(closed_manifold(&mesh));
    let mut legacy=mesh.clone();legacy.clean_degenerate_watertight();legacy.clean_degenerate();
    assert!(!closed_manifold(&legacy),"dropping a coincident-pair bevel alone opens its neighbours");
    clean(&mut mesh);
    assert!(closed_manifold(&mesh));
    let volume=super::super::frame_snap::enclosed_volume(&mesh).abs();
    assert!((volume-1.).abs()<0.00001);
    let positions=mesh.positions.clone();let indices=mesh.indices.clone();
    clean(&mut mesh);
    assert!(closed_manifold(&mesh));
    assert_eq!(mesh.positions,positions,"finite boundary cleanup must be idempotent");
    assert_eq!(mesh.indices,indices);
}
