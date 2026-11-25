// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use super::*;

fn source(depth: f64, tilt: f64, boundary: bool, mixed: bool) -> String {
    let y = if boundary { -1.1 } else { -0.2 };
    let items = if mixed { "#23,#33" } else { "#23" };
    format!("#1=IFCCARTESIANPOINT((0.,0.,0.));\n\
        #2=IFCAXIS2PLACEMENT3D(#1,$,$);\n\
        #3=IFCDIRECTION((0.,0.,1.));\n\
        #4=IFCLOCALPLACEMENT($,#2);\n\
        #6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.0002,#2,$);\n\
        #7=IFCCARTESIANPOINTLIST2D(((-1.,-1.),(1.,-1.),(1.,1.),(0.5,1.),(0.5,0.5),(-1.,0.5)));\n\
        #8=IFCINDEXEDPOLYCURVE(#7,(IFCLINEINDEX((1,2,3,4,5,6,1))),$);\n\
        #9=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#8);\n\
        #11=IFCEXTRUDEDAREASOLID(#9,#2,#3,0.016);\n\
        #12=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#11));\n\
        #13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));\n\
        #100=IFCPLATE('0000000000000000000100',$,$,$,$,#4,#13,$,.NOTDEFINED.);\n\
        #20=IFCCARTESIANPOINT((0.,0.,-0.008));\n\
        #21=IFCAXIS2PLACEMENT3D(#20,$,$);\n\
        #17=IFCCARTESIANPOINTLIST2D(((-0.2,{y}),(0.2,{y}),(0.2,0.2),(-0.2,0.2)));\n\
        #18=IFCINDEXEDPOLYCURVE(#17,(IFCLINEINDEX((1,2,3,4,1))),$);\n\
        #22=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#18);\n\
        #31=IFCDIRECTION(({tilt},0.,1.));\n\
        #23=IFCEXTRUDEDAREASOLID(#22,#21,#31,{depth});\n\
        #33=IFCEXTRUDEDAREASOLID(#22,#21,#3,0.008);\n\
        #24=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',({items}));\n\
        #25=IFCPRODUCTDEFINITIONSHAPE($,$,(#24));\n\
        #200=IFCVOIDINGFEATURE('0000000000000000000200',$,$,$,$,#4,#25,$,.HOLE.);\n")
}

fn capture(source: &str) -> Option<Bool2dCut> {
    let mut decoder = EntityDecoder::new(source);
    let host = decoder.decode_by_id(100).unwrap();
    GeometryRouter::new().capture_common_plane_cut(&host, &[200], &mut decoder)
}

#[test]
fn nhip_common_plane_admits_only_every_constituent_proven_through() {
    assert!(capture(&source(0.032, 0.0, true, false)).is_some());
    assert!(capture(&source(0.008, 0.0, true, false)).is_none(), "blind pocket must retain the residual route");
    assert!(capture(&source(0.032, 0.001, true, false)).is_none(), "oblique cut must retain the residual route");
    assert!(capture(&source(0.032, 0.0, true, true)).is_none(), "one blind constituent defers the WHOLE opening");
}

#[test]
fn nhip_common_plane_leaves_eligible_interior_prefix_unchanged() {
    let source = source(0.032, 0.0, false, false);
    assert!(capture(&source).is_some(), "a retry is captured without displacing the established emit");
    let mut decoder = EntityDecoder::new(&source);
    let host = decoder.decode_by_id(100).unwrap();
    let router = GeometryRouter::new();
    let cut = router.capture_bool2d(&host, &[200], &mut decoder).unwrap();
    assert!(!cut.all_components, "the established interior route remains selected");
    let mesh = router.process_element(&host, &mut decoder).unwrap();
    let primary = router.try_interior_bool2d_cut(&mesh, &cut).unwrap().0;
    let result = router.try_bool2d_cut(&mesh, &cut).unwrap().0;
    assert_eq!(primary.positions, result.positions);
    assert_eq!(primary.indices, result.indices);
    assert_eq!(primary.normals, result.normals);
    assert_eq!(primary.origin, result.origin);
}

#[test]
fn nhip_common_plane_retry_uses_actual_sloped_and_hole_boundaries() {
    use nalgebra::Vector2;
    let mut cut = capture(&source(0.032, 0.0, true, false)).unwrap();
    cut.host_profile = Profile2D::new(vec![Point2::new(-1.0,-1.0),Point2::new(1.0,-0.8),
        Point2::new(1.0,1.0),Point2::new(-1.0,1.0)]);
    let outward = Vector2::new(0.2,-2.0).normalize();
    let original = Point2::new(0.0,-0.9) - outward * 8e-9;
    cut.footprints = vec![vec![original,Point2::new(0.2,0.0),Point2::new(-0.2,0.0)]];
    let (changed, _) = retry::regularize(&cut).unwrap();
    assert!((changed[0][0] - original).dot(&outward) > 0.0);
    assert!((changed[0][0] - original).norm() <= 2.0 * crate::kernel::mesh_bridge::SNAP_GRID);
    // The actual #150461 sloped-edge rim is 31.75 um: moving it past the
    // edge by one hygiene grid still fits its declared 200 um Precision / 4.
    let rim = Point2::new(0.0,-0.9) - outward * 31.75e-6;
    cut.footprints[0][0] = rim;
    let (changed, _) = retry::regularize(&cut).expect("source Precision admits the complete boundary movement");
    assert!((changed[0][0] - rim).norm() <= 0.0002 / 4.0);
    cut.footprints[0][0] = Point2::new(0.0,-0.9) - outward * 5e-5;
    assert!(retry::regularize(&cut).is_none(), "a resolved 50 um material bridge must survive");
    cut.host_profile = Profile2D::new(vec![Point2::new(-1.0,-1.0),Point2::new(1.0,-1.0),
        Point2::new(1.0,1.0),Point2::new(-1.0,1.0)]);
    cut.host_profile.holes.push(vec![Point2::new(-0.2,-0.2),Point2::new(0.2,-0.2),
        Point2::new(0.2,0.2),Point2::new(-0.2,0.2)]);
    cut.footprints = vec![vec![Point2::new(0.2+8e-9,0.0),Point2::new(0.5,-0.1),Point2::new(0.5,0.1)]];
    let (changed, _) = retry::regularize(&cut).unwrap();
    assert!(changed[0][0].x < 0.2, "outward from material points INTO an existing hole");
    cut.boundary_precision = Some(1e-6);
    assert!(retry::regularize(&cut).is_none());
}

#[test]
fn nhip_common_plane_31_micron_rim_survives_canonical_hygiene_closed() {
    use nalgebra::Vector2;
    let mut cut = capture(&source(0.032, 0.0, true, false)).unwrap();
    cut.host_profile = Profile2D::new(vec![Point2::new(-1.0,-1.0),Point2::new(1.0,-0.8),
        Point2::new(1.0,1.0),Point2::new(-1.0,1.0)]);
    let outward = Vector2::new(0.2,-2.0).normalize();
    let tangent = Vector2::new(2.0,0.2).normalize();
    let center = Point2::new(0.0,-0.9) - outward * 31.75e-6;
    let a = center - tangent * 0.05;
    let b = center + tangent * 0.05;
    cut.footprints = vec![vec![a,b,b-outward*0.17,a-outward*0.17]];
    let router = GeometryRouter::new();
    let host = crate::extrusion::extrude_profile_watertight(&cut.host_profile, cut.depth, None).unwrap();
    cut.boundary_precision = Some(1e-6);
    assert!(router.try_thin_box_cut(&host, &cut).is_none(), "strict Precision must refuse the formerly torn emit");
    cut.boundary_precision = Some(0.0002);
    let mut result = router.try_thin_box_cut(&host, &cut).expect("the admitted bounded retry must remain closed");
    result.clean_degenerate();
    assert!(retry::closed_manifold(&result), "later canonical cleanup must preserve the repaired surface");
}
