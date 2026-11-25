// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Nhip 2026-10-25, #198892: pairwise disjoint, closed finite Body cutters
//! leave real blind skins. This reproduction consumes actual Rust operands,
//! including their distinct origins, rather than an OCC replacement mesh.
#![cfg(feature = "test-support")]

use ifc_lite_geometry::{test_support::{finish_finite_source, subtract_finite_source_many}, Mesh};
use serde::Deserialize;
use std::{collections::HashMap, path::PathBuf};

#[derive(Deserialize)]
struct Operand {
    id: u32,
    positions: Vec<f32>,
    indices: Vec<u32>,
    origin: [f64; 3],
}

fn operands() -> Option<Vec<Operand>> {
    let explicit = std::env::var_os("IFC_LITE_NHIP_RUST_OPERANDS").map(PathBuf::from);
    let Some(path) = explicit else {
        let text = ifc_lite_testkit::local_fixture_text("local/nhip-disjoint-blind-caps.json")?;
        return Some(serde_json::from_str(&text).expect("Rust operand fixture JSON"));
    };
    match std::fs::read(&path) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).expect("Rust operand fixture JSON")),
        Err(error) => panic!("Cannot read operand fixture {}: {error}", path.display()),
    }
}

fn relative_mesh(operand: &Operand, stock_origin: [f64; 3]) -> Mesh {
    let mut mesh = Mesh::new();
    // Match VoidContext::relativized_by: fold each operand's own origin in
    // f64, subtract the STOCK origin, then narrow once. No shared-origin guess.
    mesh.positions = operand.positions.iter().enumerate().map(|(index, &value)| {
        let axis = index % 3;
        (f64::from(value) + operand.origin[axis] - stock_origin[axis]) as f32
    }).collect();
    mesh.indices = operand.indices.clone();
    mesh
}

fn scaled(mesh: &Mesh, scale: f64) -> Mesh {
    let mut result = mesh.clone();
    for coordinate in &mut result.positions { *coordinate = (f64::from(*coordinate) * scale) as f32; }
    result.origin = result.origin.map(|value| value * scale);
    result
}

fn defects(mesh: &Mesh) -> usize {
    let points = mesh.positions.as_chunks::<3>().0;
    assert!(points.iter().flatten().all(|value| value.is_finite()));
    let mut edges = HashMap::<([u32; 3], [u32; 3]), (usize, i64)>::new();
    for triangle in mesh.indices.as_chunks::<3>().0 {
        let keys = triangle.map(|index| points[index as usize].map(|v| if v == 0.0 { 0 } else { v.to_bits() }));
        for i in 0..3 {
            let (a, b) = (keys[i], keys[(i + 1) % 3]);
            let (key, direction) = if a < b { ((a, b), 1) } else { ((b, a), -1) };
            let value = edges.entry(key).or_default(); value.0 += 1; value.1 += direction;
        }
    }
    edges.values().filter(|&&(count, balance)| count != 2 || balance != 0).count()
}

fn volume(mesh: &Mesh) -> f64 {
    let points = mesh.positions.as_chunks::<3>().0;
    let center: [f64; 3] = std::array::from_fn(|axis| points.iter().map(|p| f64::from(p[axis])).sum::<f64>() / points.len() as f64);
    mesh.indices.as_chunks::<3>().0.iter().map(|triangle| {
        let [a, b, c] = triangle.map(|index| std::array::from_fn::<_, 3, _>(|axis| f64::from(points[index as usize][axis]) - center[axis]));
        a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])
    }).sum::<f64>().abs() / 6.0
}

fn collapsed(mesh: &Mesh) -> usize {
    let points = mesh.positions.as_chunks::<3>().0;
    mesh.indices.as_chunks::<3>().0.iter().filter(|triangle| {
        let [a, b, c] = triangle.map(|index| points[index as usize].map(f64::from));
        let ab: [f64; 3] = std::array::from_fn(|axis| b[axis] - a[axis]);
        let ac: [f64; 3] = std::array::from_fn(|axis| c[axis] - a[axis]);
        let cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        cross.iter().all(|&value| value == 0.0)
    }).count()
}

type Subtract = fn(&Mesh, &[&Mesh]) -> Option<Mesh>;

fn x_intersections(mesh: &Mesh, y: f64, z: f64) -> Vec<f64> {
    let points = mesh.positions.as_chunks::<3>().0;
    let mut hits = Vec::new();
    for triangle in mesh.indices.as_chunks::<3>().0 {
        let [a, b, c] = triangle.map(|index| std::array::from_fn::<_, 3, _>(|axis|
            f64::from(points[index as usize][axis]) + mesh.origin[axis]));
        let ab: [f64; 3] = std::array::from_fn(|axis| b[axis] - a[axis]);
        let ac: [f64; 3] = std::array::from_fn(|axis| c[axis] - a[axis]);
        let determinant = ab[1] * ac[2] - ab[2] * ac[1];
        if determinant.abs() < 1e-20 { continue; }
        let u = ((y - a[1]) * ac[2] - (z - a[2]) * ac[1]) / determinant;
        let v = (ab[1] * (z - a[2]) - ab[2] * (y - a[1])) / determinant;
        if u >= -1e-10 && v >= -1e-10 && u + v <= 1.0 + 1e-10 {
            hits.push(a[0] + u * ab[0] + v * ac[0]);
        }
    }
    hits.sort_by(f64::total_cmp);
    hits.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    hits
}

fn assert_blind_skins(stock: &Mesh, cutters: &[Mesh], result: &Mesh) {
    let (lo, hi) = stock.bounds();
    let mut checked = 0;
    for cutter in cutters {
        let (clo, chi) = cutter.bounds();
        let sample = [1, 2].map(|axis| {
            let margin = f64::from(chi[axis] - clo[axis]) * 0.2;
            (f64::from(clo[axis] + chi[axis]) * 0.5)
                .clamp(f64::from(lo[axis]) + margin, f64::from(hi[axis]) - margin)
        });
        let source = x_intersections(cutter, sample[0], sample[1]);
        if source.len() != 2 || source[0] >= f64::from(lo.x) { continue; }
        let expected = f64::from(hi.x) - source[1];
        // These measurable authored skins exceed both kernel work grids.
        // Sample points come from the operands; no private coordinates are pinned.
        if !(35e-6..80e-6).contains(&expected) { continue; }
        let hits = x_intersections(result, sample[0], sample[1]);
        assert_eq!(hits.len(), 2, "a blind pocket leaves two finite skin surfaces: {hits:?}");
        let actual = hits[1] - hits[0];
        assert!((actual - expected).abs() < 3e-6,
            "authored blind skin {expected} m became {actual} m");
        checked += 1;
    }
    assert!(checked > 0, "the real reproduction must exercise a resolvable blind skin");
}

fn attempt(stock: &Mesh, cutters: &[Mesh], scale: f64, subtract: Subtract, label: &str) -> bool {
    let work_stock = scaled(stock, scale);
    let work_cutters = cutters.iter().map(|mesh| scaled(mesh, scale)).collect::<Vec<_>>();
    assert_eq!(defects(&work_stock), 0, "closed stock input");
    assert!(work_cutters.iter().all(|mesh| defects(mesh) == 0), "closed finite cutter inputs");
    let Some(raw) = subtract(&work_stock, &work_cutters.iter().collect::<Vec<_>>()) else {
        eprintln!("scale={scale}: nonconforming arrangement"); return false;
    };
    eprintln!("scale={scale}: raw {} triangles, {} stored-edge defects, {} collapsed triangles", raw.triangle_count(), defects(&raw), collapsed(&raw));
    let mut dropped = raw.clone();
    ifc_lite_geometry::drop_collapsed_triangles(&dropped.positions, &mut dropped.indices);
    let mut ordinary = dropped.clone();
    ordinary.clean_degenerate_watertight();
    ordinary.clean_degenerate();
    eprintln!("scale={scale}: after collapsed-only drop {} triangles/{} defects; ordinary cleanup {} triangles/{} defects",
        dropped.triangle_count(), defects(&dropped), ordinary.triangle_count(), defects(&ordinary));
    if let Some(directory) = std::env::var_os("IFC_LITE_NHIP_RAW_DUMP").map(PathBuf::from) {
        std::fs::create_dir_all(&directory).expect("private mesh dump directory");
        let value = serde_json::json!({
            "label": label, "cutters": cutters.len(), "workScale": scale,
            "stock": {"positions": &work_stock.positions, "indices": &work_stock.indices},
            "raw": {"positions": &raw.positions, "indices": &raw.indices},
            "collapsedOnly": {"positions": &dropped.positions, "indices": &dropped.indices},
            "ordinaryCleanup": {"positions": &ordinary.positions, "indices": &ordinary.indices},
        });
        std::fs::write(directory.join(format!("{label}-{}-{scale}.json", cutters.len())),
            serde_json::to_vec(&value).expect("private mesh JSON")).expect("write private mesh dump");
    }
    let Some(work_result) = finish_finite_source(&work_stock, raw, 0.0002 * scale) else {
        eprintln!("scale={scale}: finishing refused in work units"); return false;
    };
    let physical = scaled(&work_result, 1.0 / scale);
    eprintln!("scale={scale}: restored {} stored-edge defects, {} collapsed triangles", defects(&physical), collapsed(&physical));
    let Some(result) = finish_finite_source(stock, physical, 0.0002) else {
        eprintln!("scale={scale}: finishing refused in physical units"); return false;
    };
    assert!(!result.is_empty(), "these finite cuts cannot consume the whole stock");
    assert_eq!(defects(&result), 0, "finished solid must be exactly closed");
    assert_eq!(collapsed(&result), 0, "finished solid must have no collapsed faces");
    assert!(volume(&result) < volume(stock) * 0.8, "main manufacturing opening must remove material");
    assert_blind_skins(stock, cutters, &result);
    if let Some(directory) = std::env::var_os("IFC_LITE_NHIP_RAW_DUMP").map(PathBuf::from) {
        let value = serde_json::json!({"positions": &result.positions, "indices": &result.indices,
            "origin": result.origin, "workScale": scale, "cutters": cutters.len()});
        std::fs::write(directory.join(format!("{label}-{}-{scale}-physical.json", cutters.len())),
            serde_json::to_vec(&value).expect("physical mesh JSON")).expect("write physical mesh dump");
    }
    true
}

fn check(subtract: Subtract, label: &str) {
    let Some(operands) = operands() else { return; };
    let stock = operands.iter().find(|operand| operand.id == 198892).expect("stock operand");
    let origin = stock.origin;
    let stock = relative_mesh(stock, origin);
    let mut failures = Vec::new();
    // The six-cutter reduction already fails on the older pipeline, despite
    // lying below both the 16-cutter and 2048-triangle admission limits.
    for ids in [
        vec![198896, 198916, 198936, 198940, 198956, 198960],
        operands.iter().filter(|operand| operand.id != 198892).map(|operand| operand.id).collect(),
    ] {
        let cutters = ids.iter().map(|id| relative_mesh(operands.iter().find(|operand| operand.id == *id).expect("cutter operand"), origin)).collect::<Vec<_>>();
        eprintln!("finite cutter IDs: {ids:?}");
        let accepted = [256.0, 16.0].into_iter().map(|scale| attempt(&stock, &cutters, scale, subtract, label)).collect::<Vec<_>>();
        if !accepted.iter().any(|&value| value) { failures.push(ids); }
    }
    assert!(failures.is_empty(), "closed disjoint finite operands need a closed physical result: {failures:?}");
}

#[test]
fn nhip_disjoint_finite_blind_caps_survive_source_arrangement_and_finishing() {
    check(subtract_finite_source_many, "nary");
}

#[test]
fn finite_source_finishing_conforms_multiple_distinct_vertices_near_an_edge_endpoint() {
    use ifc_lite_geometry::kernel::{arrangement::box_mesh, mesh_bridge::tris_to_mesh};
    let stock = tris_to_mesh(&box_mesh([0.0; 3], [1.0, 1.0, 0.016]));
    let mut split = stock.clone();
    let points = stock.positions.as_chunks::<3>().0;
    let a = [0.0_f32; 3];
    let b = [1.0_f32, 0.0, 0.0];
    let c = [2.0_f32.powi(-25), 0.0, 0.0];
    let d = [2.0_f32.powi(-24), 0.0, 0.0];
    let mut replacement = None;
    for (index, triangle) in stock.indices.as_chunks::<3>().0.iter().enumerate() {
        for edge in 0..3 {
            let start = triangle[edge];
            let end = triangle[(edge + 1) % 3];
            if points[start as usize] == a && points[end as usize] == b {
                replacement = Some((index, start, end, triangle[(edge + 2) % 3]));
            }
        }
        if replacement.is_some() { break; }
    }
    let (index, start, end, third) = replacement.expect("oriented cube edge");
    let ci = (split.positions.len() / 3) as u32;
    split.positions.extend(c);
    let di = (split.positions.len() / 3) as u32;
    split.positions.extend(d);
    split.indices[index * 3..index * 3 + 3].copy_from_slice(&[start, ci, third]);
    split.indices.extend([ci, di, third, di, end, third]);
    assert_eq!(collapsed(&split), 0, "the tiny faces bound real material");
    assert!(defects(&split) > 0, "the opposite face intentionally retains its long edge");
    let result = finish_finite_source(&stock, split, 0.0002)
        .expect("exact collinear subdivision must precede near-degenerate cleanup");
    assert_eq!(defects(&result), 0);
    assert_eq!(collapsed(&result), 0);
    assert!((volume(&result) - volume(&stock)).abs() < 1e-12);
    // Final coplanar consolidation may legally omit the collinear vertices;
    // material volume and the finite closed surface are the contract here.
}
