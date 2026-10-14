// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Large collation windows, bounded binary IPC messages. A single source mesh
//! larger than the target remains one packet; this is not a file-size limit.
use crate::packet;
use ifc_lite_geometry::{encode_refs, Collated, InstanceMeshRef, InstanceTemplate};
use ifc_lite_processing::MeshData;

pub const TARGET_BYTES: usize = 8 * 1024 * 1024;

pub fn flats(meshes: &[MeshData], output: &mut Vec<Vec<u8>>) -> Result<(), String> {
    let mut start = 0;
    while start < meshes.len() {
        let (mut end, mut estimate) = (start, 16);
        while end < meshes.len() {
            let m = &meshes[end];
            let size = 512 + 4 * (m.positions.len() + m.normals.len() + m.indices.len() + m.uvs.as_ref().map_or(0, Vec::len));
            if end > start && estimate + size > TARGET_BYTES { break; }
            estimate += size;
            end += 1;
        }
        split_flat(&meshes[start..end], output)?;
        start = end;
    }
    Ok(())
}

fn split_flat(meshes: &[MeshData], output: &mut Vec<Vec<u8>>) -> Result<(), String> {
    let bytes = packet::encode(meshes)?;
    if bytes.len() > TARGET_BYTES && meshes.len() > 1 {
        let mid = meshes.len() / 2;
        split_flat(&meshes[..mid], output)?;
        split_flat(&meshes[mid..], output)?;
    } else { output.push(bytes); }
    Ok(())
}

pub fn instances(refs: &[InstanceMeshRef], collated: Collated, output: &mut Vec<Vec<u8>>) -> usize {
    let mut pending = Collated::default();
    let mut bytes = 32;
    let mut templates = 0;
    for template in collated.templates {
        let m = &refs[template.template_index];
        let geometry = 48 + 4 * (m.positions.len() + m.normals.len() + m.indices.len());
        // 100 is the widest current IFNS record; actual encoding derives its
        // stride from item IDs/finishes. Conservative accounting never wraps.
        let chunk = (TARGET_BYTES.saturating_sub(32 + geometry) / 100).max(1);
        for occurrences in template.occurrences.chunks(chunk) {
            let size = geometry + occurrences.len() * 100;
            if !pending.templates.is_empty() && bytes + size > TARGET_BYTES {
                output.push(encode_refs(refs, &pending));
                templates += pending.templates.len();
                pending.templates.clear(); bytes = 32;
            }
            pending.templates.push(InstanceTemplate { rep_identity: template.rep_identity,
                template_index: template.template_index, occurrences: occurrences.to_vec() });
            bytes += size;
        }
    }
    if !pending.templates.is_empty() { output.push(encode_refs(refs, &pending)); templates += pending.templates.len(); }
    templates
}

#[cfg(test)]
#[path = "packet_batches_tests.rs"]
mod tests;
