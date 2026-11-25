// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Real-model regression from research/nhip-fix-20261024: member #286665.
//! The stock is a rectangular 16 mm plate authored along its 3.957 m length.
//! Nine Body cutters include through cuts and genuinely blind finite cutters.
//! A successful load or a closed fallback alone does not prove the right shape.
//! The independent IfcOpenShell 0.8.5 material-volume oracle is in SI units.
//! Original-source linear deflections 1 um and 0.2 um converge to the same
//! volume (5 um differs by 1.97e-8 m3). The first-cutter reference agrees with
//! the independently integrated IFC circular-arc area within 1.33e-8 m3.
//! See research/nhip-fix-20261024/residual-families/member-286665-highres-oracle.json.

use ifc_lite_geometry::TessellationQuality;
use ifc_lite_processing::{
    process_geometry_filtered_with_quality_and_ids, MeshData, OpeningFilterMode,
};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

const HOST: u32 = 286665;
const ORACLE_VOLUME: f64 = 0.09050675564233114;

fn fixture() -> Option<Vec<u8>> {
    let explicit = std::env::var_os("IFCLITE_NHIP_MEMBER_FIXTURE")
        .or_else(|| std::env::var_os("IFC_LITE_NHIP_MODEL")).map(PathBuf::from);
    let path = explicit.clone().unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/models/local/nhip-member-286665.ifc")
    });
    match std::fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && explicit.is_none() => {
            eprintln!("Skipping private Nhip member fixture; set IFCLITE_NHIP_MEMBER_FIXTURE. Catalogued fixtures use pnpm fixtures.");
            None
        }
        Err(error) => panic!("Cannot read Nhip member fixture {}: {error}", path.display()),
    }
}

fn material_volume(mesh: &MeshData) -> f64 {
    // Center before the determinant: georeferencing must not fabricate volume.
    let points = mesh.positions.as_chunks::<3>().0;
    let center: [f64; 3] = std::array::from_fn(|axis| {
        points.iter().map(|p| f64::from(p[axis])).sum::<f64>() / points.len() as f64
    });
    mesh.indices.as_chunks::<3>().0.iter().map(|triangle| {
        let [a, b, c] = triangle.map(|index| {
            std::array::from_fn::<_, 3, _>(|axis| f64::from(points[index as usize][axis]) - center[axis])
        });
        a[0] * (b[1] * c[2] - b[2] * c[1])
            + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0])
    }).sum::<f64>().abs() / 6.0
}

fn assert_closed(mesh: &MeshData) {
    let (points, remainder) = mesh.positions.as_chunks::<3>();
    assert!(remainder.is_empty());
    assert!(points.iter().flatten().all(|coordinate| coordinate.is_finite()));
    let (triangles, remainder) = mesh.indices.as_chunks::<3>();
    assert!(remainder.is_empty());
    let mut edges = HashMap::<([u32; 3], [u32; 3]), (usize, i64)>::new();
    for triangle in triangles {
        assert!(triangle.iter().all(|&index| (index as usize) < points.len()));
        let [a, b, c] = triangle.map(|index| points[index as usize].map(f64::from));
        let ab: [f64; 3] = std::array::from_fn(|axis| b[axis] - a[axis]);
        let ac: [f64; 3] = std::array::from_fn(|axis| c[axis] - a[axis]);
        let cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        assert!(cross.iter().map(|v| v * v).sum::<f64>() > 0.0, "collapsed output triangle");
        // Exact stored coordinates, with signed zero canonicalized. A tolerance
        // weld would conceal open cracks or erase the genuine blind skins.
        let keys = triangle.map(|index| points[index as usize].map(|v| if v == 0.0 { 0 } else { v.to_bits() }));
        for i in 0..3 {
            let (a, b) = (keys[i], keys[(i + 1) % 3]);
            let (key, direction) = if a < b { ((a, b), 1) } else { ((b, a), -1) };
            let entry = edges.entry(key).or_default();
            entry.0 += 1;
            entry.1 += direction;
        }
    }
    let invalid = edges.values().filter(|&&(count, balance)| count != 2 || balance != 0).count();
    assert_eq!(invalid, 0, "every material edge must have two opposite incident faces");
}

#[test]
fn nhip_member_286665_preserves_material_with_finite_body_cutters() {
    let Some(bytes) = fixture() else { return; };
    let ids = HashSet::from([HOST]);
    let result = process_geometry_filtered_with_quality_and_ids(
        &bytes, OpeningFilterMode::Default, TessellationQuality::Medium, Some(&ids),
    );
    let meshes = result.meshes.iter().filter(|mesh| mesh.express_id == HOST).collect::<Vec<_>>();
    assert!(!meshes.is_empty(), "the cut member must remain visible");
    let actual: f64 = meshes.iter().map(|mesh| material_volume(mesh)).sum();
    // 2 cm³ permits tessellation/representation error while rejecting the
    // observed 2076 cm³ excess from the open fallback. Blind cuts stay finite.
    assert!((actual - ORACLE_VOLUME).abs() < 2e-6,
        "material volume {actual} m³ differs from independent oracle {ORACLE_VOLUME} m³");
    for mesh in meshes { assert_closed(mesh); }
}
