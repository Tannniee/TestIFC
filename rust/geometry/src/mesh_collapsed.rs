// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Exact f32-collapse cleanup shared by finite-source geometry and the final
//! coordinate conversion. A short altitude alone does not make a face empty.

fn has_area(positions:&[f32],triangle:[u32;3])->bool {
    let point = |index: u32| -> Option<[f64; 3]> {
        let start = (index as usize).checked_mul(3)?;
        let p = positions.get(start..start.checked_add(3)?)?;
        Some([f64::from(p[0]),f64::from(p[1]),f64::from(p[2])])
    };
    let [Some(a),Some(b),Some(c)] = triangle.map(point) else {return false;};
    let ab = [b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    let ac = [c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    let normal = [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    !normal.iter().all(|value| *value == 0.)
}

/// Detect the same zero-area or invalid-index faces the cleanup removes,
/// without allocating or changing the mesh.
pub fn has_collapsed_triangles(positions:&[f32],indices:&[u32])->bool {
    indices.as_chunks::<3>().0.iter().any(|triangle|!has_area(positions,*triangle))
}

/// Remove zero-area triangles and invalid indices, preserving every finite
/// positive-area face. Signed zeros have the same geometric position. No
/// coordinate, normal or vertex index is changed; returns the number removed.
pub fn drop_collapsed_triangles(positions: &[f32], indices: &mut Vec<u32>) -> u64 {
    let before = indices.len() / 3;
    let mut kept = 0;
    for read in 0..before {
        let triangle = [indices[read*3],indices[read*3+1],indices[read*3+2]];
        if !has_area(positions,triangle){continue;}
        indices[kept*3..kept*3+3].copy_from_slice(&triangle);
        kept += 1;
    }
    indices.truncate(kept*3);
    (before-kept) as u64
}
