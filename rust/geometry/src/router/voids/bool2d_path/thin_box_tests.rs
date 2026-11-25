// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use super::*;

fn cutter(scale: f64, z: f64) -> ExtrudedSolidInfo {
    ExtrudedSolidInfo {
        profile: Profile2D::new(vec![Point2::new(-scale, -scale), Point2::new(scale, -scale),
            Point2::new(scale, scale), Point2::new(-scale, scale)]),
        depth: 0.016 * scale,
        dir_sign: 1.0,
        m: Matrix4::new_translation(&Vector3::new(0.0, 0.0, z)),
    }
}

/// Nhip #2444: numerical face coincidence must not turn a measurable blind
/// pocket into a through-cut. The allowance is physical, in metres.
#[test]
fn thin_axis_box_accepts_roundoff_but_refuses_blind_and_oblique_cutters() {
    let inv = Matrix4::identity();
    let zero = (0.0, 0.0, 0.0);
    assert!(thin_footprint(&cutter(1.0, 8e-8), &inv, 0.016, 1.0, zero).is_some());
    assert!(thin_footprint(&cutter(1.0, 1e-5), &inv, 0.016, 1.0, zero).is_none());
    let mut oblique = cutter(1.0, 0.0);
    oblique.m = nalgebra::Rotation3::from_axis_angle(&Vector3::x_axis(), 2e-7).to_homogeneous();
    assert!(thin_footprint(&oblique, &inv, 0.016, 1.0, zero).is_none());
    let mut annular = cutter(1.0, 0.0);
    annular.profile.holes.push(vec![Point2::new(0.0, 0.0), Point2::new(0.1, 0.0), Point2::new(0.0, 0.1)]);
    assert!(thin_footprint(&annular, &inv, 0.016, 1.0, zero).is_none());
}

#[test]
fn thin_axis_box_projection_keeps_metric_tolerance_under_millimetres_and_rtc() {
    let inv = Matrix4::identity();
    let a = thin_footprint(&cutter(1.0, 8e-8), &inv, 0.016, 1.0, (0.0, 0.0, 0.0)).unwrap();
    let mut mm = cutter(1000.0, 8e-5);
    mm.m[(0, 3)] = 563_254_707.0;
    mm.m[(1, 3)] = 1_100_446_627.0;
    let rtc = (563_254.707, 1_100_446.627, 0.0);
    let b = thin_footprint(&mm, &inv, 0.016, 0.001, rtc).unwrap();
    assert!(a.iter().zip(b).all(|(a, b)| (a - b).norm() < 1e-9));
    mm.m[(2, 3)] = 0.01; // A 0.01 mm blind skin is not roundoff.
    assert!(thin_footprint(&mm, &inv, 0.016, 0.001, rtc).is_none());
}

#[test]
fn nhip_source_axis_roundoff_requires_metric_through_proof_and_preserves_real_bevels() {
    let inv=Matrix4::identity();let rtc=(0.,0.,0.);
    let mut source=cutter(1.,-0.05);source.depth=0.1;
    source.m=Matrix4::new_translation(&Vector3::new(0.,0.,-0.05))
        *nalgebra::Rotation3::from_axis_angle(&Vector3::x_axis(),1.41e-7).to_homogeneous();
    assert!(thin_footprint(&source,&inv,0.016,1.,rtc).is_none(),"ordinary routing keeps its angular contract");
    assert!(thin_footprint_impl(&source,&inv,0.016,1.,rtc,true).is_some(),"14 nm sweep drift is within the existing metric bound");
    source.m=Matrix4::new_translation(&Vector3::new(0.,0.,-0.05))
        *nalgebra::Rotation3::from_axis_angle(&Vector3::x_axis(),0.005).to_homogeneous();
    assert!(thin_footprint_impl(&source,&inv,0.016,1.,rtc,true).is_none(),"real oblique sides stay 3D");
    let blind=cutter(1.,1e-5);
    assert!(thin_footprint_impl(&blind,&inv,0.016,1.,rtc,true).is_none(),"a 10 um blind skin cannot become a through-hole");
}

#[test]
fn thin_axis_box_proof_refuses_trapezoids_and_sheared_transforms() {
    let source = cutter(1.0, 0.0);
    assert!(clean_box(&source, 1.0, (0.0, 0.0, 0.0)).is_some());
    let mut trapezoid = cutter(1.0, 0.0);
    trapezoid.profile.outer[2].x += 1e-3;
    assert!(clean_box(&trapezoid, 1.0, (0.0, 0.0, 0.0)).is_none());
    let mut shear = cutter(1.0, 0.0);
    shear.m[(0, 1)] = 1e-3;
    assert!(clean_box(&shear, 1.0, (0.0, 0.0, 0.0)).is_none());
    let mut nonfinite = cutter(1.0, 0.0);
    nonfinite.profile.outer[2].x = f64::NAN;
    assert!(clean_box(&nonfinite, 1.0, (0.0, 0.0, 0.0)).is_none());
    assert!(thin_footprint(&nonfinite, &Matrix4::identity(), 0.016, 1.0, (0.0, 0.0, 0.0)).is_none());
}

#[test]
fn thin_axis_box_difference_refuses_to_silently_fill_a_degenerate_hole() {
    let profile = cutter(1.0, 0.0).profile;
    let tiny = vec![Point2::new(0.0, 0.0), Point2::new(1e-6, 0.0),
        Point2::new(1e-6, 1e-6), Point2::new(0.0, 1e-6)];
    assert!(subtract_multiple_2d_all(&profile, &[tiny]).is_err());
}

fn retry_cut(gap: f64, precision: Option<f64>) -> Bool2dCut {
    Bool2dCut {
        all_components: true, boundary_precision: precision,
        rectangular_boundary: true,
        common_fallback: None,
        host_profile: cutter(1.25, 0.0).profile,
        depth: 0.01, dir_sign: 1.0, wt: Matrix4::identity(), residual: None,
        footprints: vec![vec![Point2::new(-1.25 + gap, -0.125), Point2::new(-1.0, -0.125),
            Point2::new(-1.0, 0.125), Point2::new(-1.25 + gap, 0.125)]],
    }
}

#[test]
fn nhip_boundary_retry_obeys_declared_precision_and_retains_resolved_bridges() {
    assert!(retry::regularize(&retry_cut(8e-9, None)).is_none());
    assert!(retry::regularize(&retry_cut(8e-9, Some(1e-6))).is_none());
    assert!(retry::regularize(&retry_cut(1e-5, Some(1e-6))).is_none());
    assert!(retry::regularize(&retry_cut(5e-5, Some(0.0002))).is_none());
    let mut overlapping_bands = retry_cut(8e-9, Some(0.0002));
    overlapping_bands.host_profile.outer[2].x = crate::kernel::mesh_bridge::SNAP_GRID;
    assert!(retry::regularize(&overlapping_bands).is_none());
    let mut nonfinite = retry_cut(8e-9, Some(0.0002));
    nonfinite.footprints[0][1].x = f64::INFINITY;
    assert!(retry::regularize(&nonfinite).is_none());
    let original = retry_cut(8e-9, Some(0.0002));
    let (changed, envelope) = retry::regularize(&original).unwrap();
    let grid = crate::kernel::mesh_bridge::SNAP_GRID;
    assert!(envelope > 0.0);
    assert!(changed[0][0].x < -1.25, "tolerance coincidence must form an open notch");
    for (a, b) in original.footprints[0].iter().zip(&changed[0]) {
        assert!((a - b).norm() <= 2.0 * grid && (a - b).norm() <= 0.0002 / 4.0);
    }
}

#[test]
fn nhip_body_precision_uses_relevant_context_and_bounds_parent_walk() {
    let source = "#1=IFCMEMBER('0000000000000000000001',$,$,$,$,$,#2,$,.NOTDEFINED.);\n\
        #2=IFCPRODUCTDEFINITIONSHAPE($,$,(#3,#4));\n\
        #3=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#20));\n\
        #4=IFCSHAPEREPRESENTATION(#12,'Axis','Curve3D',(#21));\n\
        #10=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#11,$,.MODEL_VIEW.,$);\n\
        #11=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.2,$,$);\n\
        #12=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1e-9,$,$);";
    let read = |source: &str| {
        let mut decoder = EntityDecoder::new(source);
        let host = decoder.decode_by_id(1).unwrap();
        retry::context_precision(&host, &mut decoder, 0.001)
    };
    assert_eq!(read(source), Some(0.0002));
    assert_eq!(read(&source.replace("*,*,*,*,#11", "*,*,*,*,#10")), None);
    assert_eq!(read(&source.replace("3,0.2,$,$", "3,$,$,$")), None);
    let mut deep = source.replace("*,*,*,*,#11", "*,*,*,*,#100");
    for id in 100..120 {
        deep.push_str(&format!("\n#{id}=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#{},$,.MODEL_VIEW.,$);", id + 1));
    }
    deep.push_str("\n#120=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.2,$,$);");
    assert_eq!(read(&deep), None);
}

#[test]
fn nhip_exact_manifold_rejects_pinches_open_edges_and_reversed_faces() {
    let profile = cutter(1.0, 0.0).profile;
    let mesh = extrude_profile_watertight(&profile, 0.01, None).unwrap();
    assert!(retry::closed_manifold(&mesh));
    let mut signed_zero = mesh.clone();
    for v in &mut signed_zero.positions { if *v == 0.0 { *v = -0.0; } }
    assert!(retry::closed_manifold(&signed_zero));
    let mut open = mesh.clone(); open.indices.truncate(open.indices.len() - 3);
    assert!(!retry::closed_manifold(&open));
    let mut reversed = mesh.clone(); reversed.indices.swap(0, 1);
    assert!(!retry::closed_manifold(&reversed));
    let mut pinch = mesh.clone(); pinch.merge(&mesh);
    assert!(!retry::closed_manifold(&pinch), "balanced edges with multiplicity four are not manifold");
    let mut nonfinite = mesh.clone(); nonfinite.positions[0] = f32::NAN;
    assert!(!retry::closed_manifold(&nonfinite));
}
