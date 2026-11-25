// SPDX-License-Identifier: MPL-2.0
use super::*;

// Brief 01: a site frame must never replace an installed authored stock frame.
// Raw STEP and the manufacturing memo intentionally describe different frames.
#[test]
fn brief_01_site_frame_preserves_an_already_installed_authored_placement() {
    let source = "#1=IFCCARTESIANPOINT((100.,200.,0.));\n\
        #2=IFCAXIS2PLACEMENT3D(#1,$,$);\n#3=IFCLOCALPLACEMENT($,#2);\n\
        #4=IFCCARTESIANPOINT((4.,3.,0.));\n#5=IFCAXIS2PLACEMENT3D(#4,$,$);\n\
        #6=IFCLOCALPLACEMENT(#3,#5);\n\
        #10=IFCSITE('0000000000000000000010',$,$,$,$,#3,$,$,.ELEMENT.,$,$,$,$,$);\n\
        #20=IFCPLATE('0000000000000000000020',$,$,$,$,#6,$,$,.NOTDEFINED.);";
    let mut decoder = EntityDecoder::new(source);
    let host = decoder.decode_by_id(20).unwrap();
    let ordinary = GeometryRouter::with_scale(1.);
    let mut frame = CutFrame::Unchosen;
    frame.choose(&host, true, &ordinary, &mut decoder);
    let scope = frame.enter(&ordinary).expect("control must actually enter the nonidentity site frame");
    let relative = ordinary.placement_in_frame(&host, &mut decoder).unwrap().unwrap();
    assert_eq!((relative[(0, 3)], relative[(1, 3)]), (4., 3.));
    drop(scope);

    // This is the same canonical cache that source_frame::MemoScope installs.
    let mut cache = FxHashMap::default();
    cache.insert(6, *Matrix4::<f64>::identity().as_slice().first_chunk::<16>().unwrap());
    decoder.set_placement_transform_cache(cache);
    let mut authored = GeometryRouter::with_scale(1.);
    authored.source_frame_active = true;
    authored.precision_frame = Some(0.0002);
    let mut frame = CutFrame::Unchosen;
    frame.choose(&host, true, &authored, &mut decoder);
    let _scope = frame.enter(&authored);
    let at = authored.placement_in_frame(&host, &mut decoder).unwrap().unwrap();
    assert_eq!(at, Matrix4::identity(), "the stock stays at its authored origin; cutters and BVH use that same frame");
}
