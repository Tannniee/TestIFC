// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use super::*;
use ifc_lite_geometry::{decode_instanced, InstanceMeta};

// A rotated site with a large RTC. B = R_site^T * T(-RTC).
const BASIS: [f64; 16] = [0., 1., 0., -1200000., -1., 0., 0., 600000., 0., 0., 1., -42., 0., 0., 0., 1.];
fn pose(i: u32) -> MeshData {
    let (c, s) = if i.is_multiple_of(2) { (1., 0.) } else { (0., 1.) };
    let translation = [600000. + f64::from(i) * 5., 1200000. + 3., 42. + f64::from(i)];
    let mut mesh = MeshData::new(i + 1, "IfcBeam".into(),
        // site-local vectors R_site^T * R_pose * local, triangle in YZ
        vec![0., 0., 0., c as f32, s as f32, 0., 0., 0., 1.],
        [s as f32, -c as f32, 0.].repeat(3), vec![0, 1, 2], [0.1 * i as f32, 0.5, 0.75, 1.]);
    mesh.origin = [translation[1] - 1200000., -(translation[0] - 600000.), translation[2] - 42.];
    mesh.geometry_item_id = Some(100 + i);
    mesh.instance = Some(InstanceMeta {
        transform: [c, -s, 0., translation[0], s, c, 0., translation[1], 0., 0., 1., translation[2], 0., 0., 0., 1.],
        local_transform: None, canonical_transform: None, rep_identity: 50, instanceable: true,
    });
    mesh
}
fn empty_bounds() -> [f64; 6] { [f64::INFINITY, f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY] }

#[test]
fn verified_instances_preserve_each_rotated_pose_normals_indices_color_and_item() {
    let meshes: Vec<_> = (0..8).map(pose).collect();
    let result = encode(&meshes, &BASIS, &mut empty_bounds()).unwrap();
    assert_eq!((result.flat_meshes, result.occurrences, result.templates), (0, 8, 1));
    let shard = decode_instanced(&result.packets[0]).unwrap();
    for instance in shard.instances {
        let template = &shard.templates[instance.template_index as usize];
        let mut expected = meshes[(instance.entity_id - 1) as usize].clone();
        packet::restore_world_axes(&mut expected, &BASIS);
        assert_eq!(instance.item_id, expected.geometry_item_id);
        assert_eq!(instance.color, expected.color);
        assert_eq!(template.indices, expected.indices);
        let t = instance.transform;
        for (index, p) in template.positions.as_chunks::<3>().0.iter().enumerate() {
            for k in 0..3 {
                let actual = f64::from(t[k * 4 + 3]) + (0..3).map(|a| f64::from(t[k * 4 + a])
                    * (f64::from(p[a]) + template.origin[a])).sum::<f64>();
                let expected_point = f64::from(expected.positions[index * 3 + k]) + expected.origin[k];
                assert!((actual - expected_point).abs() < 0.0002);
                let normal: f32 = (0..3).map(|a| t[k * 4 + a] * template.normals[index * 3 + a]).sum();
                assert!((normal - expected.normals[index * 3 + k]).abs() < 1e-6);
            }
        }
    }
}

#[test]
fn transparency_class_switches_and_shape_rejections_retain_flat_geometry() {
    let mut meshes: Vec<_> = (0..8).map(pose).collect();
    let mut glass = pose(8); glass.color[3] = 0.5; meshes.push(glass);
    let mut space = pose(9); space.ifc_type = "IfcSpace".into(); meshes.push(space);
    let mut type_map = pose(10); type_map.geometry_class = 2; meshes.push(type_map);
    let result = encode(&meshes, &BASIS, &mut empty_bounds()).unwrap();
    assert_eq!((result.flat_meshes, result.occurrences), (3, 8));
    let mut wrong = pose(11); wrong.positions[0] += 0.5; meshes.push(wrong);
    let result = encode(&meshes, &BASIS, &mut empty_bounds()).unwrap();
    assert_eq!(result.flat_meshes + result.occurrences, meshes.len());
    assert!(result.flat_meshes >= 4, "a mismatched shape cannot disappear into an invalid template");
}
