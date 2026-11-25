// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! One conforming arrangement for a stock and possibly overlapping finite
//! cutters. Internal cutter faces are classified before any f32 round-trip.
use super::{arrange_many_with_policy, boolean::{centroid_multi, tri_normal_multi, point_via_interner},
    classify::dot3, source_query::Operand, strict_union::{keep_face_using, Probe}, Tri};
use super::super::surface_policy::SurfacePolicy;

pub(crate) fn difference(host: &[Tri], cutters: &[&[Tri]]) -> Option<(Vec<Tri>, bool)> {
    if cutters.is_empty() { return Some((host.to_vec(), false)); }
    let operands: Vec<_> = std::iter::once(host).chain(cutters.iter().copied()).collect();
    let arrangement = arrange_many_with_policy(&operands, SurfacePolicy::SourceStrict);
    if arrangement.unrecovered != 0 || super::super::budget::tripped() { return None; }
    let queries: Vec<_> = operands.iter().map(|mesh| Operand::new(mesh)).collect();
    let mut scratch = Vec::new();
    let mut out = Vec::new();
    let mut host_kept = 0;
    for (owner, triangles) in arrangement.subtris.iter().enumerate() {
        for &triangle in triangles {
            let centroid = centroid_multi(&arrangement, triangle);
            let normal = tri_normal_multi(&arrangement, triangle);
            let keep = if owner == 0 {
                queries[1..].iter().all(|cutter| {
                    if let Some(other_normal) = cutter.surface_normal(centroid, normal, &mut scratch) {
                        dot3(normal, other_normal) < 0.
                    } else {
                        !cutter.contains(centroid, &mut scratch)
                    }
                })
            } else {
                queries[0].surface_normal(centroid, normal, &mut scratch).is_none()
                    && queries[0].contains(centroid, &mut scratch)
                    && keep_face_using(normal, owner - 1, cutters.len(), |other| {
                        let cutter = &queries[other + 1];
                        if let Some(n) = cutter.surface_normal(centroid, normal, &mut scratch) { Probe::Surface(n) }
                        else if cutter.contains(centroid, &mut scratch) { Probe::Inside }
                        else { Probe::Outside }
                    })
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
