// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use ifc_lite_desktop::{native::{Jobs, INPUT_CHUNK_BYTES}, packet};
use ifc_lite_processing::{build_geometry_data_export, process_geometry, MeshCoordinateSpace};
use std::{collections::BTreeMap, path::PathBuf, time::{Duration, Instant}};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/viewer/public/samples/building-architecture.ifc")
}

/// Independent reconstruction of the transport's world vertices. The oracle
/// below is the existing native export, which folds canonical site/RTC frames.
fn vertices(packet: &[u8], rtc: [f64; 3]) -> BTreeMap<u32, Vec<[f64; 3]>> {
    let word = |at| u32::from_le_bytes(packet[at..at + 4].try_into().unwrap());
    assert_eq!(word(0), packet::MAGIC);
    assert_eq!(word(4), packet::VERSION);
    let len = word(8) as usize;
    let descriptors: Vec<serde_json::Value> = serde_json::from_slice(&packet[16..16 + len]).unwrap();
    assert_eq!(descriptors.len(), word(12) as usize);
    let mut offset = 16 + ((len + 3) & !3);
    let mut result = BTreeMap::<u32, Vec<[f64; 3]>>::new();
    for descriptor in descriptors {
        let count = descriptor["positionsLen"].as_u64().unwrap() as usize;
        let origin = descriptor["origin"].as_array().unwrap();
        let origin: Vec<_> = origin.iter().map(|v| v.as_f64().unwrap()).collect();
        let mut points = Vec::new();
        for i in (0..count).step_by(3) {
            let read = |axis| f64::from(f32::from_le_bytes(packet[offset + (i + axis) * 4..offset + (i + axis + 1) * 4].try_into().unwrap()));
            // Wire [x,z,-y] -> native [x,y,z], restoring RTC in native axes.
            points.push([read(0) + origin[0] + rtc[0],
                -(read(2) + origin[2]) + rtc[1], read(1) + origin[1] + rtc[2]]);
        }
        let id = descriptor["expressId"].as_u64().unwrap() as u32;
        result.entry(id).or_default().extend(points);
        let words: usize = ["positionsLen", "normalsLen", "indicesLen", "uvsLen"].iter()
            .map(|key| descriptor[key].as_u64().unwrap() as usize).sum();
        offset += words * 4;
    }
    assert_eq!(offset, packet.len());
    result
}

#[test]
fn real_ifc_binary_transport_preserves_world_vertices_and_bounds() {
    let bytes = std::fs::read(fixture()).unwrap();
    qualify_world_transport(&bytes, None);
}

#[test]
fn rotated_site_preserves_world_geometry_and_camera_rotation_metadata() {
    let source = std::fs::read_to_string(fixture()).unwrap();
    let rotated = source.replace("#10=IFCDIRECTION((1.,0.,0.));", "#10=IFCDIRECTION((0.,1.,0.));");
    assert_ne!(source, rotated, "fixture's site axis must be rotated");
    qualify_world_transport(rotated.as_bytes(), Some(std::f64::consts::FRAC_PI_2));
}

fn qualify_world_transport(bytes: &[u8], expected_rotation: Option<f64>) {
    let base = process_geometry(bytes);
    let rotation = (base.mesh_coordinate_space == MeshCoordinateSpace::SiteLocal)
        .then_some(base.site_transform.as_deref()).flatten();
    let oracle = build_geometry_data_export(&base.meshes, base.metadata.coordinate_info.origin_shift, rotation);
    let jobs = Jobs::default();
    let id = jobs.create().unwrap();
    for chunk in bytes.chunks(INPUT_CHUNK_BYTES) { jobs.append(&id, chunk).unwrap(); }
    jobs.start(&id).unwrap();
    assert!(jobs.start(&id).is_err(), "one worker per job");
    assert!(jobs.append(&id, b"late mutation").is_err());
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut packets = Vec::new();
    let summary = loop {
        assert!(Instant::now() < deadline, "native fixture deadline");
        let packet = jobs.next_packet(&id).unwrap();
        if !packet.is_empty() { packets.push(packet); continue; }
        let status = jobs.status(&id).unwrap();
        assert!(status.error.is_none(), "{:?}", status.error);
        if status.done {
            let tail = jobs.next_packet(&id).unwrap();
            if !tail.is_empty() { packets.push(tail); continue; }
            break status.summary.unwrap();
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let progress = jobs.status(&id).unwrap().progress;
    assert!(progress.processed_elements > 0);
    assert!(progress.processed_elements <= progress.total_elements);
    assert_eq!(progress.meshes, summary.stats.total_meshes);
    let progress_wire = serde_json::to_value(&progress).unwrap();
    assert_eq!(progress_wire["processedElements"], progress.processed_elements);
    assert_eq!(progress_wire["totalElements"], progress.total_elements);
    let mut actual = BTreeMap::<u32, Vec<[f64; 3]>>::new();
    for packet in &packets {
        for (id, points) in vertices(packet, summary.metadata.coordinate_info.origin_shift) {
            actual.entry(id).or_default().extend(points);
        }
    }
    assert_eq!(summary.stats.total_meshes, base.stats.total_meshes);
    assert_eq!(summary.stats.total_vertices, base.stats.total_vertices);
    if let Some(expected) = expected_rotation {
        assert!((summary.building_rotation.expect("site camera rotation") - expected).abs() < 1e-10);
    }
    for (id, expected) in oracle.elements {
        let actual = actual.get(&id).expect("all source entities survive transport");
        // The analysis oracle welds duplicate render vertices. Compare every
        // actual vertex against its world point, then require every oracle
        // point to survive as well; render counts were checked above.
        let close = |a: &[f64; 3], b: &[f64; 3]| (0..3).all(|axis| (a[axis] - b[axis]).abs() < 0.0002);
        for point in actual { assert!(expected.vertices.iter().any(|v| close(point, v)), "#{id} unexpected world vertex {point:?}"); }
        for point in &expected.vertices { assert!(actual.iter().any(|v| close(point, v)), "#{id} missing world vertex {point:?}"); }
        for axis in 0..3 {
            let extrema = |points: &[[f64; 3]]| (
                points.iter().map(|p| p[axis]).fold(f64::INFINITY, f64::min),
                points.iter().map(|p| p[axis]).fold(f64::NEG_INFINITY, f64::max));
            let (amin, amax) = extrema(actual);
            let (emin, emax) = extrema(&expected.vertices);
            assert!((amin - emin).abs() < 0.0002 && (amax - emax).abs() < 0.0002, "#{id} bounds axis {axis}");
        }
    }
    jobs.close(&id).unwrap();
    assert!(jobs.status(&id).is_err(), "closed sources cannot be queried");
}

#[test]
fn raw_ingress_validates_chunks_and_rejects_non_ifc_without_panicking() {
    let jobs = Jobs::default();
    let id = jobs.create().unwrap();
    assert!(jobs.append(&id, &[]).is_err());
    assert!(jobs.append(&id, &vec![0; INPUT_CHUNK_BYTES + 1]).is_err());
    jobs.append(&id, b"not a STEP model").unwrap();
    jobs.start(&id).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !jobs.status(&id).unwrap().done {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(jobs.status(&id).unwrap().error.unwrap().contains("STEP IFC"));
    jobs.close(&id).unwrap();
    jobs.close(&id).unwrap();
}
