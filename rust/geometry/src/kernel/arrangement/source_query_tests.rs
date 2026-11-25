// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Nhip load 2026-10-27: spatial pruning must preserve the exhaustive exact
//! predicates, including face order and positive gaps below the import grid.
use super::Operand;
use super::super::{box_mesh, ray_parity::{operand_extent, point_inside},
    surface::on_surface_normal, Tri};
use super::super::super::broadphase::tris_aabb;

fn far_boxes(triangles: &mut Vec<Tri>) {
    for i in 0..64 {
        let x = 100. + f64::from(i) * 4.;
        triangles.extend(box_mesh([x, -3., -2.], [x + 1., -2., -1.]));
    }
}

fn normal(t: Tri) -> [f64; 3] {
    let a = std::array::from_fn::<_, 3, _>(|i| t[1][i] - t[0][i]);
    let b = std::array::from_fn::<_, 3, _>(|i| t[2][i] - t[0][i]);
    [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
}

fn assert_oracle(triangles: &[Tri], points: &[[f64; 3]], normals: &[[f64; 3]]) {
    let operand = Operand::new(triangles);
    let mut scratch = vec![u32::MAX];
    let extent = operand_extent(triangles);
    let bounds = tris_aabb(triangles);
    for &point in points {
        assert_eq!(operand.contains(point, &mut scratch),
            point_inside(point, triangles, extent, bounds), "ray parity at {point:?}");
        for &n in normals {
            assert_eq!(operand.surface_normal(point, n, &mut scratch),
                on_surface_normal(point, n, triangles), "surface at {point:?}, normal {n:?}");
        }
    }
}

#[test]
fn nhip_source_query_matches_exhaustive_oblique_faces_edges_and_corners() {
    let shear = |p: [f64; 3]| [p[0] + 0.5*p[2], p[1] + 0.25*p[2], p[2]];
    let primary: Vec<Tri> = box_mesh([-1., -1., -1.], [1., 1., 1.])
        .into_iter().map(|t| t.map(shear)).collect();
    let mut points = vec![shear([0., 0., 0.]), shear([2., 0., 0.]), shear([-2., 2., 1.])];
    let mut normals = vec![[1., 0., 0.], [-1., 0., 0.], [0., 1., 0.], [0., 0., -1.]];
    for &triangle in &primary {
        points.push(triangle[0]);
        points.push(std::array::from_fn(|i| (triangle[0][i] + triangle[1][i])*0.5));
        points.push(std::array::from_fn(|i|
            triangle[0][i]*0.5 + triangle[1][i]*0.25 + triangle[2][i]*0.25));
        let n = normal(triangle);
        normals.push(n);
        normals.push(n.map(|v| -v));
    }
    let mut triangles = primary;
    far_boxes(&mut triangles);
    assert_oracle(&triangles, &points, &normals);
}

#[test]
fn nhip_source_query_returns_the_first_original_matching_face_normal() {
    let first = [[0., 0., 0.], [2., 0., 0.], [0., 2., 0.]];
    let opposite = [first[0], first[2], first[1]];
    let larger = [[0., 0., 0.], [4., 0., 0.], [0., 4., 0.]];
    for lead in [first, opposite, larger] {
        let mut triangles = vec![lead];
        far_boxes(&mut triangles);
        triangles.extend([opposite, larger, first]);
        let operand = Operand::new(&triangles);
        let mut scratch = Vec::new();
        for n in [[0., 0., 1.], [0., 0., -1.]] {
            assert_eq!(operand.surface_normal([0.5, 0.5, 0.], n, &mut scratch),
                Some(normal(lead)), "BVH traversal cannot choose another coincident face");
        }
    }
}

#[test]
fn nhip_source_query_keeps_subgrid_positive_gaps_and_exact_surface_policy() {
    let gap = 1e-8;
    let mut triangles = box_mesh([0., 0., 0.], [1., 1., 1.]);
    triangles.extend(box_mesh([0., 0., 1. + gap], [1., 1., 2.]));
    far_boxes(&mut triangles);
    let operand = Operand::new(&triangles);
    let mut scratch = Vec::new();
    let gap_point = [0.25, 0.25, 1. + gap*0.5];
    assert!(!operand.contains(gap_point, &mut scratch), "positive air gap is not material");
    assert_eq!(operand.surface_normal(gap_point, [0., 0., 1.], &mut scratch), None);
    assert_oracle(&triangles, &[
        [0.25, 0.25, 1.], gap_point, [0.25, 0.25, 1. + gap],
        [0.25, 0.25, 1. - gap], [0.25, 0.25, 1. + gap*2.],
    ], &[[0., 0., 1.], [0., 0., -1.]]);
}

fn l_prism() -> Vec<Tri> {
    let ring = [[0., 0.], [2., 0.], [2., 1.], [1., 1.], [1., 2.], [0., 2.]];
    let at = |i: usize, z| [ring[i][0], ring[i][1], z];
    let mut out = Vec::new();
    for [a, b, c] in [[0, 1, 3], [1, 2, 3], [0, 3, 5], [3, 4, 5]] {
        out.push([at(a, 0.), at(c, 0.), at(b, 0.)]);
        out.push([at(a, 1.), at(b, 1.), at(c, 1.)]);
    }
    for a in 0..ring.len() {
        let b = (a + 1) % ring.len();
        out.push([at(a, 0.), at(b, 0.), at(b, 1.)]);
        out.push([at(a, 0.), at(b, 1.), at(a, 1.)]);
    }
    out
}

#[test]
fn nhip_source_query_preserves_nonconvex_and_disconnected_solid_parity() {
    let mut triangles = l_prism();
    triangles.extend(box_mesh([4., 0., 0.], [5., 1., 1.]));
    far_boxes(&mut triangles);
    let cases = [
        ([0.25, 1.5, 0.5], true), ([1.5, 0.25, 0.5], true),
        ([1.5, 1.5, 0.5], false), ([3., 0.25, 0.5], false),
        ([4.25, 0.25, 0.5], true), ([4.25, 0.25, 1.5], false),
        ([100.25, -2.75, -1.75], true), ([100.25, -1.75, -1.75], false),
    ];
    let operand = Operand::new(&triangles);
    let mut scratch = Vec::new();
    for (point, expected) in cases {
        assert_eq!(operand.contains(point, &mut scratch), expected, "solid membership at {point:?}");
    }
    let points = cases.map(|(point, _)| point);
    assert_oracle(&triangles, &points, &[[1., 0., 0.], [0., -1., 0.], [0., 0., 1.]]);
}

#[test]
fn nhip_source_query_empty_operand_has_neither_material_nor_a_surface() {
    let operand = Operand::new(&[]);
    let mut scratch = vec![u32::MAX];
    assert!(!operand.contains([0., 0., 0.], &mut scratch));
    assert_eq!(operand.surface_normal([0., 0., 0.], [0., 0., 1.], &mut scratch), None);
}
