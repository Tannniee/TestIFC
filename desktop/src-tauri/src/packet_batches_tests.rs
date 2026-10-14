// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use super::*;
use ifc_lite_geometry::{decode_instanced, InstanceOccurrence};

#[test]
fn large_flat_batch_splits_at_ipc_boundary_without_losing_meshes() {
    let meshes: Vec<_> = (1..=5).map(|id| MeshData::new(id, "IfcBeam".into(),
        vec![0.; 300000], vec![0.; 300000], vec![0, 1, 2], [1.; 4])).collect();
    let mut packets = Vec::new(); flats(&meshes, &mut packets).unwrap();
    assert!(packets.len() > 1);
    let mut ids = Vec::new();
    for bytes in packets {
        assert!(bytes.len() <= TARGET_BYTES);
        let length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        let rows: Vec<serde_json::Value> = serde_json::from_slice(&bytes[16..16 + length]).unwrap();
        ids.extend(rows.iter().map(|v| v["expressId"].as_u64().unwrap()));
    }
    assert_eq!(ids, vec![1, 2, 3, 4, 5]);
}

#[test]
fn splitting_a_large_instance_group_counts_repeated_wire_templates_and_preserves_all_occurrences() {
    let positions = vec![0.; 300000];
    let normals = vec![0.; 300000];
    let indices = vec![0, 1, 2];
    let refs: Vec<_> = (1..=65000).map(|entity_id| InstanceMeshRef {
        positions: &positions, normals: &normals, indices: &indices, origin: [0.; 3],
        instance_meta: None, entity_id, color: [0.25, 0.5, 0.75, 1.], item_id: Some(51),
    }).collect();
    let identity = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.];
    let group = InstanceTemplate { rep_identity: 50, template_index: 0,
        occurrences: (0..refs.len()).map(|mesh_index| InstanceOccurrence { mesh_index, transform: identity }).collect() };
    let mut packets = Vec::new();
    let count = instances(&refs, Collated { templates: vec![group], ..Collated::default() }, &mut packets);
    assert_eq!(count, 2);
    let mut ids = Vec::new();
    for bytes in packets {
        assert!(bytes.len() <= TARGET_BYTES);
        let decoded = decode_instanced(&bytes).unwrap();
        assert_eq!(decoded.templates[0].positions.len(), positions.len());
        for instance in decoded.instances {
            assert_eq!(instance.item_id, Some(51)); assert_eq!(instance.color, [0.25, 0.5, 0.75, 1.]);
            ids.push(instance.entity_id);
        }
    }
    assert_eq!(ids, (1..=65000).collect::<Vec<_>>());
}
