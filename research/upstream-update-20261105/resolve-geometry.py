from resolve import ROOT, OUT, resolve, edit
import subprocess
PIN='2cf5d2fa7f7831aa8282c944d7a2a67fa3cf878e'

resolve('rust/geometry/src/lib.rs','both')
resolve('rust/geometry/src/processors/mod.rs','theirs')
with (ROOT/'rust/geometry/src/processors/mod.rs').open('a') as f:f.write('\npub(crate) use boolean::cap_half_space_clip;\n')
resolve('rust/geometry/src/processors/boolean/mod.rs','ours')
resolve('rust/geometry/src/profiles/curves_2d.rs','ours')
resolve('rust/geometry/src/profiles/mod.rs','ours')
edit('rust/geometry/src/profiles/chord_precision.rs',
    'chord_tolerance:None,curve_budget:Cell::new(MAX_CURVE_NODES)',
    'chord_tolerance:None,curve_budget:Cell::new(MAX_CURVE_NODES),\n            region_budget:super::regions::WorkBudget::new(super::regions::MAX_PROFILE_REGIONS),\n            point_budget:super::regions::WorkBudget::new(super::regions::MAX_PROFILE_POINTS)')
resolve('rust/geometry/src/router/mod.rs',['theirs',
    '    length_unit_refused: bool,\n    config: RouterConfig,\n    precision_frame: Option<f64>,\n    source_frame_active: bool,\n    source_boundary_verdict: std::cell::Cell<Option<(u32, crate::OrientVerdict)>>,\n',
    'theirs'])
edit('rust/geometry/src/router/mod.rs','            config: RouterConfig::default(),',
    '            config: RouterConfig::default(),\n            precision_frame: None,\n            source_frame_active: false,\n            source_boundary_verdict: std::cell::Cell::new(None),')
for name in ('construction','processing','rtc_offset','layers'):
    resolve(f'rust/geometry/src/router/{name}.rs','theirs')
resolve('rust/geometry/src/router/voids/representation.rs','theirs')
resolve('rust/geometry/src/router/voids/geom.rs','theirs')
resolve('rust/geometry/src/router/voids/synthesis.rs','theirs')
resolve('rust/geometry/src/router/voids/mod.rs',['theirs']*5+['both'])
resolve('rust/geometry/src/router/voids/prism_cut.rs',['theirs','both','ours','theirs'])
resolve('rust/geometry/src/router/voids/probe.rs',
    '        let processor = if let Some(precision) = self.precision_frame {\n            ProfileProcessor::with_chord_tolerance(self.schema.clone(), precision * 0.25 / self.unit_scale())\n        } else { ProfileProcessor::new(self.schema.clone()) };\n        let [profile] = <[_; 1]>::try_from(processor.process_regions(&profile_entity, decoder, self.tessellation_quality()).ok()?).ok()?;\n')

resolve('rust/geometry/src/kernel/arrangement/mod.rs',['theirs']*5)
# The original local retriangulator returns two vectors; the new canonical one
# in the parent also returns component ownership, and is required by binary.rs.
p='rust/geometry/src/kernel/arrangement/mod.rs'
text=(ROOT/p).read_text()
text=text.replace('use super::tritri::{tri_tri_intersection_with_band, TriTri};','use super::tritri::{tri_tri_intersection_with_band_and_policy, TriTri};\nuse super::surface_policy::SurfacePolicy;')
text=text.replace('mod retriangulate_each;\nuse retriangulate_each::retriangulate_each;\n','')
(ROOT/p).write_text(text,encoding='utf-8')

resolve('rust/geometry/src/kernel/tritri.rs','theirs')
p='rust/geometry/src/kernel/tritri.rs'
edit(p,'tri_tri_intersection_scoped(t1, t2, None)','tri_tri_intersection_scoped(t1, t2, None, super::surface_policy::SurfacePolicy::ImportReconciled)')
edit(p,'tri_tri_intersection_scoped(t1, t2, Some(band))','tri_tri_intersection_scoped(t1, t2, Some(band), super::surface_policy::SurfacePolicy::ImportReconciled)')
edit(p,'fn tri_tri_intersection_scoped(t1: &[[f64; 3]; 3], t2: &[[f64; 3]; 3], paired_band: Option<&NearBand>) -> TriTri {',
'''pub(crate) fn tri_tri_intersection_with_policy(t1: &[[f64; 3]; 3], t2: &[[f64; 3]; 3], policy: super::surface_policy::SurfacePolicy) -> TriTri {
    tri_tri_intersection_scoped(t1, t2, None, policy)
}

pub(crate) fn tri_tri_intersection_with_band_and_policy(t1: &[[f64; 3]; 3], t2: &[[f64; 3]; 3], band: &NearBand, policy: super::surface_policy::SurfacePolicy) -> TriTri {
    tri_tri_intersection_scoped(t1, t2, Some(band), policy)
}

fn tri_tri_intersection_scoped(t1: &[[f64; 3]; 3], t2: &[[f64; 3]; 3], paired_band: Option<&NearBand>, policy: super::surface_policy::SurfacePolicy) -> TriTri {''')
edit(p,'    if near_coplanar(t1, t2, &local_band) || paired_band.is_some_and(|band|',
    '    if policy.reconcile() && (near_coplanar(t1, t2, &local_band) || paired_band.is_some_and(|band|')
edit(p,'&& near_coplanar(t1, t2, band) && exactly_parallel_planes(t1, t2)) {',
    '&& near_coplanar(t1, t2, band) && exactly_parallel_planes(t1, t2))) {')

p='rust/geometry/src/kernel/arrangement/binary.rs'
edit(p,'pub(super) fn arrange(a: &[Tri], b: &[Tri]) -> Arrangement {',
'''pub(super) fn arrange(a: &[Tri], b: &[Tri]) -> Arrangement {
    arrange_with_policy(a, b, SurfacePolicy::ImportReconciled)
}
pub(super) fn arrange_with_policy(a: &[Tri], b: &[Tri], policy: SurfacePolicy) -> Arrangement {''')
edit(p,'vec![NearBand::from_operands(a, b)])','vec![NearBand::from_operands(a, b)], policy)')
edit(p,'pub(super) fn arrange_components(a: &[Tri], comps: &[&[Tri]]) -> Arrangement {',
'''pub(super) fn arrange_components(a: &[Tri], comps: &[&[Tri]]) -> Arrangement {
    arrange_components_with_policy(a, comps, SurfacePolicy::ImportReconciled)
}
pub(super) fn arrange_components_with_policy(a: &[Tri], comps: &[&[Tri]], policy: SurfacePolicy) -> Arrangement {''')
edit(p,'arrange_scoped(a, &b, &owners, bands)','arrange_scoped(a, &b, &owners, bands, policy)')
edit(p,'bands: Vec<NearBand>) -> Arrangement','bands: Vec<NearBand>, policy: SurfacePolicy) -> Arrangement')
edit(p,'tri_tri_intersection_with_band(ta, tb, &bands[parent_component_b[j]])',
    'tri_tri_intersection_with_band_and_policy(ta, tb, &bands[parent_component_b[j]], policy)')
with (ROOT/'rust/geometry/src/kernel/arrangement/mod.rs').open('a') as f:
    f.write('\nuse binary::arrange_with_policy;\n')

resolve('rust/geometry/src/kernel/arrangement/boolean.rs',[
    '    let arr = super::binary::arrange_components_with_policy(a, comps, policy);\n',
    '    let result = classify_difference(&arr, a, comps, policy);\n    (!super::super::budget::tripped()).then_some(result)\n',
'''    difference_all_lenient_with_conformity_and_policy(a, comps, SurfacePolicy::ImportReconciled)
}

pub(crate) fn difference_all_lenient_with_conformity_and_policy(a: &[Tri], comps: &[&[Tri]], policy: SurfacePolicy) -> (Vec<Tri>, bool, bool) {
    if comps.is_empty() { return (a.to_vec(), false, true); }
    let arr = super::binary::arrange_components_with_policy(a, comps, policy);
    let (tris, changed) = classify_difference(&arr, a, comps, policy);
    (tris, changed, arr.unrecovered == 0 && !super::super::budget::tripped())
'''])

resolve('rust/processing/src/element.rs','theirs')
resolve('rust/processing/src/element_degenerate.rs','both')
resolve('rust/processing/src/element_mesh_build.rs','ours')
edit('rust/processing/src/element_mesh_build.rs','ctx.site_local_rotation','site_local_rotation')
print('Resolved core geometry ownership and policy wiring; remaining semantic ports are explicit.')
