use super::*;

// Nhip footing investigation: a tessellated wedge must never become its AABB
// merely because the triangulator chooses the same first vertex on its slope.
#[test]
fn nhip_tapered_hexahedron_is_not_an_orthogonal_box() {
    let mut mesh=Mesh::new();
    mesh.positions=vec![-0.5,-0.5,0., 0.5,-0.5,0., 0.5,0.5,0., -0.5,0.5,0.,
        -0.4,-0.5,2., 0.5,-0.5,2., 0.5,0.5,2., -0.4,0.5,2.];
    mesh.indices=vec![0,3,2,0,2,1, 4,5,6,4,6,7, 0,1,5,0,5,4,
        1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7];
    assert!(!is_rectangular_box_mesh(&mesh),"the inward-sloping face is not an axis-aligned plane");
    mesh.positions[12] = -0.5;mesh.positions[21] = -0.5;
    assert!(is_rectangular_box_mesh(&mesh),"the orthogonal control is a genuine box");
}
