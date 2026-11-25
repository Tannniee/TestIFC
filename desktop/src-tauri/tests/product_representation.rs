// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use ifc_lite_core::EntityDecoder;
use ifc_lite_geometry::GeometryRouter;
use ifc_lite_processing::process_geometry;

// An anonymous IFC2X3 extrusion, independent of the user's private model.
// Its base representation has the same layout as IfcProductDefinitionShape.
fn fixture(container: &str) -> String {
    format!(r#"ISO-10303-21;
HEADER; FILE_SCHEMA(('IFC2X3')); ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCLOCALPLACEMENT($,#2);
#4=IFCDIRECTION((0.,0.,1.));
#5=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#2,$);
#6=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,2.,4.);
#7=IFCEXTRUDEDAREASOLID(#6,#2,#4,6.);
#8=IFCSHAPEREPRESENTATION(#5,'Body','SweptSolid',(#7));
#9={container}($,$,(#8));
#10=IFCBEAM('0000000000000000000001',$,'Beam',$,$,#3,#9,$);
ENDSEC;
END-ISO-10303-21;"#)
}

#[test]
fn ifc2x3_base_product_representation_meshes_in_both_router_paths() {
    let control = fixture("IFCPRODUCTDEFINITIONSHAPE");
    let legacy = fixture("IFCPRODUCTREPRESENTATION");
    let mut control_decoder = EntityDecoder::new(control.as_bytes());
    let control_element = control_decoder.decode_by_id(10).unwrap();
    let expected = GeometryRouter::new().process_element(&control_element, &mut control_decoder).unwrap();
    assert!(!expected.indices.is_empty(), "the control must actually render");
    let mut decoder = EntityDecoder::new(legacy.as_bytes());
    let element = decoder.decode_by_id(10).unwrap();
    let router = GeometryRouter::new();
    let actual = router.process_element(&element, &mut decoder).unwrap();
    assert_eq!(actual.positions, expected.positions);
    assert_eq!(actual.indices, expected.indices);
    let parts = router.process_element_with_submeshes(&element, &mut decoder).unwrap();
    assert_eq!(parts.sub_meshes.len(), 1);
    assert_eq!(parts.sub_meshes[0].mesh.positions, expected.positions);
    assert_eq!(parts.sub_meshes[0].mesh.indices, expected.indices);
}

#[test]
fn ifc2x3_base_product_representation_keeps_large_coordinate_anchor() {
    let legacy = fixture("IFCPRODUCTREPRESENTATION").replace(
        "#3=IFCLOCALPLACEMENT($,#2);",
        "#20=IFCCARTESIANPOINT((600000.,1200000.,42.));\n#21=IFCAXIS2PLACEMENT3D(#20,$,$);\n#3=IFCLOCALPLACEMENT($,#21);",
    );
    let mut decoder = EntityDecoder::new(legacy.as_bytes());
    let anchor = GeometryRouter::new().detect_rtc_anchor_for_file(legacy.as_bytes(), &mut decoder);
    assert_eq!(anchor, Some((600000., 1200000., 42.)));
}

#[test]
fn ifc2x3_base_product_representation_votes_for_near_origin_geometry() {
    let source = fixture("IFCPRODUCTREPRESENTATION");
    let mut decoder = EntityDecoder::new(source.as_bytes());
    assert_eq!(GeometryRouter::new().detect_rtc_anchor_for_file(source.as_bytes(), &mut decoder), Some((0., 0., 0.)));
}

#[test]
fn canonical_processing_emits_base_product_representation_geometry() {
    let control = process_geometry(fixture("IFCPRODUCTDEFINITIONSHAPE").as_bytes());
    let legacy = process_geometry(fixture("IFCPRODUCTREPRESENTATION").as_bytes());
    assert_eq!(control.stats.total_meshes, 1);
    assert_eq!(legacy.stats.total_meshes, control.stats.total_meshes);
    assert_eq!(legacy.stats.total_vertices, control.stats.total_vertices);
    assert_eq!(legacy.stats.total_triangles, control.stats.total_triangles);
    assert_eq!(legacy.meshes[0].positions, control.meshes[0].positions);
    assert_eq!(legacy.meshes[0].indices, control.meshes[0].indices);
}

#[test]
fn unrelated_material_representation_is_still_rejected_as_product_shape() {
    let source = fixture("IFCMATERIALDEFINITIONREPRESENTATION").replace(
        "#9=IFCMATERIALDEFINITIONREPRESENTATION($,$,(#8));",
        "#11=IFCMATERIAL('Material');\n#9=IFCMATERIALDEFINITIONREPRESENTATION($,$,(#8),#11);",
    );
    let mut decoder = EntityDecoder::new(source.as_bytes());
    let element = decoder.decode_by_id(10).unwrap();
    let router = GeometryRouter::new();
    assert!(router.process_element(&element, &mut decoder).is_err());
    assert!(router.process_element_with_submeshes(&element, &mut decoder).is_err());
}
