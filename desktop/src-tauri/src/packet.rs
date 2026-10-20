// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Desktop packet v1: 16-byte LE header, padded JSON descriptors, binary pools.
//! Numeric geometry is never expanded into JSON. Offsets are packet-local;
//! source file positions remain native usize and never pass through this format.
use ifc_lite_processing::MeshData;
use serde::Serialize;

pub const MAGIC: u32 = 0x44434649; // IFCD
pub const VERSION: u32 = 1;

/// Exact bounds of transmitted Y-up vertices, including their f64 origins.
/// Computing this on the producer avoids a full, blocking UI vertex scan after
/// all geometry and BIM objects have become resident in the WebView heap.
pub fn extend_viewer_bounds(bounds: &mut [f64; 6], mesh: &MeshData) -> Result<(), String> {
    for p in mesh.positions.as_chunks::<3>().0 {
        for axis in 0..3 {
            let value = f64::from(p[axis]) + mesh.origin[axis];
            if !value.is_finite() { return Err("Native IFC returned a non-finite vertex".into()); }
            bounds[axis] = bounds[axis].min(value);
            bounds[axis + 3] = bounds[axis + 3].max(value);
        }
    }
    Ok(())
}

/// Re-express site-local vectors in world axes, using the canonical producer's
/// published basis. Translation remains in metadata; no f32 world bake.
pub fn restore_world_axes(mesh: &mut MeshData, basis: &[f64; 16]) {
    let rotate = |p: [f64; 3]| [
        basis[0] * p[0] + basis[4] * p[1] + basis[8] * p[2],
        basis[1] * p[0] + basis[5] * p[1] + basis[9] * p[2],
        basis[2] * p[0] + basis[6] * p[1] + basis[10] * p[2],
    ];
    for values in [&mut mesh.positions, &mut mesh.normals] {
        for p in values.as_chunks_mut::<3>().0 {
            let r = rotate([f64::from(p[0]), f64::from(p[1]), f64::from(p[2])]);
            for i in 0..3 { p[i] = r[i] as f32; }
        }
    }
    mesh.origin = rotate(mesh.origin);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Descriptor<'a> {
    express_id: u32,
    ifc_type: &'a str,
    color: [f32; 4],
    origin: [f64; 3],
    geometry_class: u8,
    geometry_item_id: Option<u32>,
    material_id: Option<u32>,
    local_bounds: Option<[f32; 6]>,
    local_to_world: Option<[f64; 16]>,
    positions_len: usize,
    normals_len: usize,
    indices_len: usize,
    uvs_len: usize,
    texture: Option<&'a ifc_lite_processing::MeshTextureData>,
}

pub fn encode(meshes: &[MeshData]) -> Result<Vec<u8>, String> {
    let descriptors: Vec<_> = meshes.iter().map(|m| Descriptor {
        express_id: m.express_id, ifc_type: &m.ifc_type, color: m.color,
        origin: m.origin, geometry_class: m.geometry_class,
        geometry_item_id: m.geometry_item_id, material_id: m.material_id,
        local_bounds: m.local_bounds.map(|b| [b[0], b[2], -b[4], b[3], b[5], -b[1]]),
        local_to_world: m.local_to_world.map(yup_matrix),
        positions_len: m.positions.len(), normals_len: m.normals.len(),
        indices_len: m.indices.len(), uvs_len: m.uvs.as_ref().map_or(0, Vec::len),
        texture: m.texture.as_ref(),
    }).collect();
    let metadata = serde_json::to_vec(&descriptors).map_err(|e| e.to_string())?;
    let padded = (metadata.len() + 3) & !3;
    let mut bytes = Vec::new();
    for value in [MAGIC, VERSION, u32::try_from(metadata.len()).map_err(|_| "Packet metadata exceeds u32")?,
        u32::try_from(meshes.len()).map_err(|_| "Packet mesh count exceeds u32")?] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes.extend_from_slice(&metadata);
    bytes.resize(16 + padded, 0);
    for mesh in meshes {
        for values in [&mesh.positions, &mesh.normals] {
            for value in values { bytes.extend_from_slice(&value.to_le_bytes()); }
        }
        for value in &mesh.indices { bytes.extend_from_slice(&value.to_le_bytes()); }
        if let Some(uvs) = &mesh.uvs {
            for value in uvs { bytes.extend_from_slice(&value.to_le_bytes()); }
        }
    }
    Ok(bytes)
}

fn yup_matrix(matrix: [f64; 16]) -> [f64; 16] {
    // Basis conjugation P*M*P^-1, using the transport's [x,z,-y] convention.
    let axes = [0, 2, 1, 3];
    let signs = [1.0, 1.0, -1.0, 1.0];
    let mut result = [0.0; 16];
    for i in 0..4 { for j in 0..4 {
        result[i * 4 + j] = signs[i] * matrix[axes[i] * 4 + axes[j]] * signs[j];
    } }
    result
}
