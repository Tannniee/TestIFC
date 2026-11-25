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
    if word(0) == ifc_lite_desktop::partition::BOUNDS_MAGIC { return BTreeMap::new(); }
    if word(0) == 0x4946_4E53 {
        let shard = ifc_lite_geometry::decode_instanced(packet).unwrap();
        let mut result = BTreeMap::<u32, Vec<[f64; 3]>>::new();
        for occurrence in shard.instances {
            let template = &shard.templates[occurrence.template_index as usize];
            let t = occurrence.transform;
            for p in template.positions.as_chunks::<3>().0 {
                let v: [f64; 3] = std::array::from_fn(|k| f64::from(p[k]) + template.origin[k]);
                let world = std::array::from_fn(|k| rtc[k] + f64::from(t[k * 4 + 3])
                    + (0..3).map(|a| f64::from(t[k * 4 + a]) * v[a]).sum::<f64>());
                result.entry(occurrence.entity_id).or_default().push(world);
            }
        }
        return result;
    }
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

fn qualify_world_transport(bytes: &[u8], expected_rotation: Option<f64>) -> ifc_lite_desktop::native::Summary {
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
    let rtc = summary.metadata.coordinate_info.origin_shift;
    let mut expected_bounds = [f64::INFINITY, f64::INFINITY, f64::INFINITY,
        f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for points in actual.values() {
        for p in points {
            let shifted_yup = [p[0] - rtc[0], p[2] - rtc[2], -(p[1] - rtc[1])];
            for axis in 0..3 {
                expected_bounds[axis] = expected_bounds[axis].min(shifted_yup[axis]);
                expected_bounds[axis + 3] = expected_bounds[axis + 3].max(shifted_yup[axis]);
            }
        }
    }
    for (actual, expected) in summary.viewer_bounds.iter().zip(expected_bounds) {
        assert!((actual - expected).abs() < 0.0002, "native viewer bounds must match every world vertex");
    }
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
    summary
}

#[test]
fn repeated_real_geometry_uses_ifns_and_preserves_rotated_large_rtc_world_vertices() {
    let source = std::fs::read_to_string(fixture()).unwrap();
    let product = source.lines().find(|line| line.starts_with("#395=IFCSLAB(")).unwrap();
    let mut copies = String::new();
    for i in 0..32 { copies.push_str(&product.replacen("#395=", &format!("#{}=", 10000 + i), 1)); copies.push('\n'); }
    let mut source = source;
    source.insert_str(source.rfind("ENDSEC;").unwrap(), &copies);
    let source = source
        .replace("#10=IFCDIRECTION((1.,0.,0.));", "#10=IFCDIRECTION((0.,1.,0.));")
        .replace("#8=IFCCARTESIANPOINT((0.,0.,0.));", "#8=IFCCARTESIANPOINT((600000000.,1200000000.,42000.));");
    assert!(source.contains("#10031=IFCSLAB"));
    let summary = qualify_world_transport(source.as_bytes(), Some(std::f64::consts::FRAC_PI_2));
    assert!(summary.instanced_occurrences >= 8, "real pipeline must exercise IFNS, not merely flat fallback");
    assert!(summary.instanced_templates < summary.instanced_occurrences);
    assert_eq!(summary.flat_meshes + summary.instanced_occurrences, summary.stats.total_meshes);
    assert!(summary.metadata.coordinate_info.origin_shift[0].abs() > 100000.);
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
