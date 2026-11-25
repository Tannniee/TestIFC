// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! One conforming arrangement for a stock and possibly overlapping finite
//! cutters. Internal cutter faces are classified before any f32 round-trip.
use super::{arrange_many_with_policy, boolean::{centroid_multi, tri_normal_multi, point_via_interner},
    classify::dot3, ray_parity::{operand_extent, point_inside}, strict_union::keep_face,
    surface::on_surface_normal, Tri};
use super::super::{broadphase::tris_aabb, surface_policy::SurfacePolicy};

pub(crate) fn difference(host: &[Tri], cutters: &[&[Tri]]) -> Option<(Vec<Tri>, bool)> {
    if cutters.is_empty() { return Some((host.to_vec(), false)); }
    let operands: Vec<_> = std::iter::once(host).chain(cutters.iter().copied()).collect();
    let arrangement = arrange_many_with_policy(&operands, SurfacePolicy::SourceStrict);
    if arrangement.unrecovered != 0 || super::super::budget::tripped() { return None; }
    let bounds: Vec<_> = operands.iter().map(|mesh| tris_aabb(mesh)).collect();
    let extents: Vec<_> = operands.iter().map(|mesh| operand_extent(mesh)).collect();
    let mut out = Vec::new();
    let mut host_kept = 0;
    for (owner, triangles) in arrangement.subtris.iter().enumerate() {
        for &triangle in triangles {
            let centroid = centroid_multi(&arrangement, triangle);
            let normal = tri_normal_multi(&arrangement, triangle);
            let keep = if owner == 0 {
                cutters.iter().enumerate().all(|(i, cutter)| {
                    if let Some(other_normal) = on_surface_normal(centroid, normal, cutter) {
                        dot3(normal, other_normal) < 0.
                    } else {
                        !point_inside(centroid, cutter, extents[i + 1], bounds[i + 1])
                    }
                })
            } else {
                on_surface_normal(centroid, normal, host).is_none()
                    && point_inside(centroid, host, extents[0], bounds[0])
                    && keep_face(centroid, normal, owner - 1, cutters, &extents[1..], &bounds[1..])
            };
            if keep {
                host_kept += usize::from(owner == 0);
                let indices = if owner == 0 { triangle } else { [triangle[0], triangle[2], triangle[1]] };
                out.push(indices.map(|id| point_via_interner(&arrangement.interner, id)));
            }
        }
    }
    let changed = host_kept != arrangement.subtris[0].len() || out.len() != host_kept;
    Some((out, changed))
}
