// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use super::super::{interner::{Interner, Vid}, retriangulate::{triangulate, Constraint, RetriInput}, ImplicitPoint};
use super::Tri;
/// Re-triangulate each original triangle over the shared interner. Returns the
/// conforming sub-triangles AND a parallel `coplanar` flag (each sub-triangle
/// inherits its parent original triangle's `cop_parent[i]` — "had a coplanar
/// overlap with the other operand"). The flag drives the [`solid_side`] regime-2
/// classification in `boolean_vids` only where it can matter.
pub(super) fn retriangulate_each(
    tris: &[Tri],
    cons: &[Vec<Constraint>],
    pts: &[Vec<ImplicitPoint>],
    cop_parent: &[bool],
    it: &mut Interner,
    unrecovered: &mut usize,
) -> (Vec<[Vid; 3]>, Vec<bool>) {
    let mut out = Vec::new();
    let mut coplanar = Vec::new();
    for (i, t) in tris.iter().enumerate() {
        // Escalation guardrail (#1109): the seam retriangulation runs exact
        // orient2d per ear and is the other heavy escalation site. Stop once the
        // budget is blown — the caller discards the partial arrangement.
        if super::super::budget::tripped() {
            break;
        }
        let parent_cop = cop_parent.get(i).copied().unwrap_or(false);
        let passthrough = |it: &mut Interner| {
            [
                it.intern(ImplicitPoint::Explicit(t[0])),
                it.intern(ImplicitPoint::Explicit(t[1])),
                it.intern(ImplicitPoint::Explicit(t[2])),
            ]
        };
        let before = out.len();
        let tri_pts = pts.get(i).cloned().unwrap_or_default();
        if cons[i].is_empty() && tri_pts.is_empty() {
            out.push(passthrough(it));
        } else if let Some(mesh) = triangulate(
            &RetriInput { tri: *t, constraints: cons[i].clone(), points: tri_pts },
            it,
        ) {
            *unrecovered += mesh.unrecovered;
            out.extend(mesh.tris);
        } else {
            out.push(passthrough(it)); // degenerate triangle — pass through
        }
        coplanar.resize(out.len(), parent_cop);
        debug_assert!(coplanar.len() == out.len() && before <= out.len());
    }
    (out, coplanar)
}
