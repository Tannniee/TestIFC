// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Regression for the Nhip chinh Reference/Body defect researched in
//! IFC-Lite/research/nhip-chinh-deep-20261024/NGHIEN-CUU-NHIP-CHINH.md.
//! The invariant is IFC4 Reference Geometry: a reference shape describes an
//! existing feature; it neither renders as a physical solid nor cuts the host.

use ifc_lite_processing::{process_geometry, MeshData, ProcessingResult};

fn fixture(body: bool, reference: bool, feature_type: &str) -> String {
    let representations = match (body, reference) {
        (true, true) => "#31,#32",
        (true, false) => "#31",
        (false, true) => "#32",
        (false, false) => unreachable!("fixture needs geometry"),
    };
    let predefined_type = match feature_type {
        "IFCVOIDINGFEATURE" => ".HOLE.",
        "IFCBUILDINGELEMENTPROXY" | "IFCEARTHWORKSCUT" => ".NOTDEFINED.",
        _ => ".OPENING.",
    };
    let schema = if feature_type == "IFCEARTHWORKSCUT" { "IFC4X3" } else { "IFC4" };
    let relation = if feature_type == "IFCBUILDINGELEMENTPROXY" {
        ""
    } else {
        "#41=IFCRELVOIDSELEMENT('0000000000000000000004',$,$,$,#20,#40);"
    };
    format!(r#"ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Reference feature regression'),'2;1');
FILE_NAME('reference-feature.ifc','2026-10-24T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('{schema}'));
ENDSEC;
DATA;
#1=IFCPROJECT('0000000000000000000001',$,'Project',$,$,$,$,(#5),#7);
#2=IFCCARTESIANPOINT((0.,0.,0.));
#3=IFCAXIS2PLACEMENT3D(#2,$,$);
#4=IFCLOCALPLACEMENT($,#3);
#5=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#3,$);
#6=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#7=IFCUNITASSIGNMENT((#6));
#8=IFCDIRECTION((0.,0.,1.));
#10=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,10.,10.);
#11=IFCEXTRUDEDAREASOLID(#10,#3,#8,1.);
#12=IFCSHAPEREPRESENTATION(#5,'Body','SweptSolid',(#11));
#13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));
#20=IFCSLAB('0000000000000000000002',$,'Host',$,$,#4,#13,$,.FLOOR.);
#21=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,2.,2.);
#22=IFCEXTRUDEDAREASOLID(#21,#3,#8,1.);
#23=IFCCARTESIANPOINT((3.,0.,0.));
#24=IFCAXIS2PLACEMENT3D(#23,$,$);
#25=IFCEXTRUDEDAREASOLID(#21,#24,#8,1.);
#31=IFCSHAPEREPRESENTATION(#5,'Body','SweptSolid',(#22));
#32=IFCSHAPEREPRESENTATION(#5,'Reference','SweptSolid',(#25));
#33=IFCPRODUCTDEFINITIONSHAPE($,$,({representations}));
#40={feature_type}('0000000000000000000003',$,'Feature',$,$,#4,#33,$,{predefined_type});
{relation}
ENDSEC;
END-ISO-10303-21;
"#)
}

fn volume(mesh: &MeshData) -> f64 {
    mesh.indices.as_chunks::<3>().0.iter().map(|triangle| {
        let p = [triangle[0], triangle[1], triangle[2]].map(|index| {
            let index = index as usize * 3;
            [f64::from(mesh.positions[index]), f64::from(mesh.positions[index + 1]),
                f64::from(mesh.positions[index + 2])]
        });
        p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1])
            + p[0][1] * (p[1][2] * p[2][0] - p[1][0] * p[2][2])
            + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])
    }).sum::<f64>().abs() / 6.0
}

fn entity_volume(result: &ProcessingResult, id: u32) -> f64 {
    result.meshes.iter().filter(|mesh| mesh.express_id == id).map(volume).sum()
}

#[test]
fn nhip_reference_only_subtraction_features_leave_the_host_intact_and_emit_no_solid() {
    for feature_type in ["IFCVOIDINGFEATURE", "IFCOPENINGELEMENT", "IFCOPENINGSTANDARDCASE", "IFCEARTHWORKSCUT"] {
        let result = process_geometry(&fixture(false, true, feature_type));
        assert!((entity_volume(&result, 20) - 100.0).abs() < 1e-4,
            "Reference geometry must not cut the host: {feature_type}");
        assert!(!result.meshes.iter().any(|mesh| mesh.express_id == 40),
            "Reference geometry must not appear as an opaque feature: {feature_type}");
        assert_eq!(result.stats.total_csg_failures, 0);
    }
}

#[test]
fn nhip_body_only_voiding_feature_cuts_the_real_hole() {
    let result = process_geometry(&fixture(true, false, "IFCVOIDINGFEATURE"));
    assert!((entity_volume(&result, 20) - 96.0).abs() < 1e-4,
        "a real 2 x 2 through-cut must remove 4 cubic metres");
    assert!((entity_volume(&result, 40) - 4.0).abs() < 1e-4,
        "the optional feature overlay must describe only the Body cutter");
}

#[test]
fn nhip_mixed_voiding_feature_cuts_only_body_and_ignores_the_disjoint_reference() {
    let result = process_geometry(&fixture(true, true, "IFCVOIDINGFEATURE"));
    assert!((entity_volume(&result, 20) - 96.0).abs() < 1e-4,
        "Reference at x=3 must not create a second hole beside Body at x=0");
    assert!((entity_volume(&result, 40) - 4.0).abs() < 1e-4,
        "the feature overlay must exclude the separate Reference solid");
}

#[test]
fn nhip_ordinary_product_reference_rendering_keeps_its_existing_convention() {
    let result = process_geometry(&fixture(false, true, "IFCBUILDINGELEMENTPROXY"));
    assert!((entity_volume(&result, 40) - 4.0).abs() < 1e-4);
    assert!((entity_volume(&result, 20) - 100.0).abs() < 1e-4);
}
