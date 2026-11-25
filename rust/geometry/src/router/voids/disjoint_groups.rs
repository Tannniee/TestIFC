// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Stable greedy bins of pairwise-disjoint, caller-inflated cutter bounds.
pub(super) const PAD:f64=1e-3;
pub(super) fn partition(bounds:&[([f64;3],[f64;3])])->Vec<Vec<usize>> {
    let mut groups:Vec<Vec<usize>>=Vec::new();
    'candidate:for i in 0..bounds.len(){
        for group in &mut groups {
            if group.iter().all(|&j|(0..3).any(|axis|bounds[i].1[axis]<bounds[j].0[axis] || bounds[i].0[axis]>bounds[j].1[axis])){
                group.push(i);continue 'candidate;
            }
        }
        groups.push(vec![i]);
    }
    groups
}
