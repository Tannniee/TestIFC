// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Bounded native batch partition, using the kernel's verified instancing.
use crate::{axis::mesh_to_yup_in_place, packet, packet_batches};
use ifc_lite_geometry::{collate_refs, InstanceMeshRef};
use ifc_lite_processing::MeshData;

pub const BOUNDS_MAGIC: u32 = 0x42434649; // IFCB
pub struct Partition {
    pub packets: Vec<Vec<u8>>,
    pub flat_meshes: usize,
    pub occurrences: usize,
    pub templates: usize,
}

fn eligible(mesh: &MeshData) -> bool {
    mesh.geometry_class == 0 && mesh.material_id.is_none() && mesh.color[3] >= 0.99
        && mesh.texture.is_none() && mesh.uvs.is_none()
        && !matches!(mesh.ifc_type.as_str(), "IfcSpace" | "IfcSpatialZone" | "IfcOpeningElement"
            | "IfcOpeningStandardCase" | "IfcVirtualElement" | "IfcSite" | "IfcGeographicElement" | "IfcAnnotation")
}

/// IFNS carries world Z-up/post-RTC vertices, as the existing renderer expects.
/// IFCD carries Y-up vertices. The kernel's site-local basis is undone once;
/// RTC is recovered from that SAME basis, never inferred from a bounding box.
pub fn encode(meshes: &[MeshData], basis: &[f64; 16], bounds: &mut [f64; 6]) -> Result<Partition, String> {
    let mut wire = meshes.to_vec();
    for mesh in &mut wire { packet::restore_world_axes(mesh, basis); }
    let rtc = std::array::from_fn(|i| -(basis[i] * basis[3] + basis[4 + i] * basis[7] + basis[8 + i] * basis[11]));
    let candidates: Vec<_> = wire.iter().enumerate().filter(|(_, m)| eligible(m)).map(|(i, _)| i).collect();
    let refs: Vec<_> = candidates.iter().map(|&i| {
        let m = &wire[i];
        InstanceMeshRef { positions: &m.positions, normals: &m.normals, indices: &m.indices,
            origin: m.origin, instance_meta: m.instance.as_ref(), entity_id: m.express_id,
            color: m.color, item_id: m.geometry_item_id }
    }).collect();
    let mut collated = collate_refs(&refs, 8, rtc);
    if collated.dropped_placeholders != 0 { return Err("Native partition lost pose-only geometry".into()); }
    let mut instanced = vec![false; wire.len()];
    let occurrences: usize = collated.templates.iter().map(|t| t.occurrences.len()).sum();
    for template in &collated.templates {
        for occurrence in &template.occurrences { instanced[candidates[occurrence.mesh_index]] = true; }
    }
    if collated.flat_indices.len() + occurrences != refs.len() {
        return Err("Incomplete native geometry partition".into());
    }
    // Rejected and small groups must use flat rendering, never singleton draws.
    collated.flat_indices.clear();
    let mut packets = Vec::new();
    let templates = if occurrences > 0 { packet_batches::instances(&refs, collated, &mut packets) } else { 0 };
    drop(refs);
    let mut flats = Vec::new();
    let mut boxes = Vec::new();
    for (mut mesh, shared) in wire.into_iter().zip(instanced) {
        mesh_to_yup_in_place(&mut mesh);
        packet::extend_viewer_bounds(bounds, &mesh)?;
        if shared {
            let mut b = [f64::INFINITY, f64::INFINITY, f64::INFINITY,
                f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
            packet::extend_viewer_bounds(&mut b, &mesh)?;
            boxes.extend_from_slice(&mesh.express_id.to_le_bytes());
            for v in b { boxes.extend_from_slice(&v.to_le_bytes()); }
        } else { flats.push(mesh); }
    }
    if occurrences > 0 {
        let mut bytes = Vec::with_capacity(12 + boxes.len());
        for word in [BOUNDS_MAGIC, 1, occurrences as u32] { bytes.extend_from_slice(&word.to_le_bytes()); }
        bytes.extend(boxes);
        packets.push(bytes);
    }
    let flat_meshes = flats.len();
    if flat_meshes > 0 { packet_batches::flats(&flats, &mut packets)?; }
    Ok(Partition { packets, flat_meshes, occurrences, templates })
}

#[cfg(test)]
#[path = "partition_tests.rs"]
mod tests;
