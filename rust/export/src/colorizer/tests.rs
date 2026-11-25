// SPDX-License-Identifier: MPL-2.0
use super::*;
use ifc_lite_core::{EntityDecoder, EntityScanner, IfcType};

fn body_leaf(bytes: &[u8], product: u32) -> u32 {
    let mut decoder = EntityDecoder::new(bytes);
    let mut id = decoder.decode_by_id(product).unwrap().get_ref(6).unwrap();
    for _ in 0..16 {
        let entity = decoder.decode_by_id(id).unwrap();
        id = match entity.ifc_type {
            IfcType::IfcProductDefinitionShape => entity.get_refs(2).unwrap()[0],
            IfcType::IfcShapeRepresentation => entity.get_refs(3).unwrap()[0],
            IfcType::IfcMappedItem => entity.get_ref(0).unwrap(),
            IfcType::IfcRepresentationMap => entity.get_ref(1).unwrap(),
            _ => return id,
        };
    }
    panic!("Representation did not terminate");
}

fn body_color(bytes: &[u8], product: u32) -> [f64;4] {
    let leaf = body_leaf(bytes,product);
    let mut decoder = EntityDecoder::new(bytes);
    let mut scanner = EntityScanner::new(bytes);
    let mut styled = Vec::new();
    while let Some((id,name,_,_)) = scanner.next_entity() {
        if name.eq_ignore_ascii_case("IFCSTYLEDITEM") {
            let entity = decoder.decode_by_id(id).unwrap();
            if entity.get_ref(0) == Some(leaf) { styled.push(entity); }
        }
    }
    assert_eq!(styled.len(),1,"one live styled item per target");
    let mut style = decoder.decode_by_id(styled[0].get_refs(1).unwrap()[0]).unwrap();
    if style.ifc_type.name() == "IfcPresentationStyleAssignment" {
        style = decoder.decode_by_id(style.get_refs(0).unwrap()[0]).unwrap();
    }
    let rendering = decoder.decode_by_id(style.get_refs(2).unwrap()[0]).unwrap();
    let rgb = decoder.decode_by_id(rendering.get_ref(0).unwrap()).unwrap();
    [rgb.get_float(1).unwrap(),rgb.get_float(2).unwrap(),rgb.get_float(3).unwrap(),1.-rendering.get_float(1).unwrap_or(0.)]
}

fn fixture(schema: &str) -> Vec<u8> {
    let content = format!("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Colorizer regression'),'2;1');\nFILE_NAME('source.ifc','',(''),(''),'','','');\nFILE_SCHEMA(('{schema}'));\nENDSEC;\nDATA;\n\
#1=IFCCARTESIANPOINT((0.,0.,0.));\n#2=IFCAXIS2PLACEMENT3D(#1,$,$);\n\
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#2,$);\n\
#4=IFCDIRECTION((0.,0.,1.));\n#5=IFCRECTANGLEPROFILEDEF(.AREA.,'IPE200',#20,0.1,0.2);\n\
#20=IFCAXIS2PLACEMENT2D(#21,$);\n#21=IFCCARTESIANPOINT((0.,0.));\n\
#6=IFCEXTRUDEDAREASOLID(#5,#2,#4,3.);\n\
#7=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#6));\n\
#8=IFCREPRESENTATIONMAP(#2,#7);\n#9=IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#1,1.,$);\n\
#10=IFCMAPPEDITEM(#8,#9);\n#11=IFCSHAPEREPRESENTATION(#3,'Body','MappedRepresentation',(#10));\n\
#12=IFCPRODUCTDEFINITIONSHAPE($,$,(#11));\n\
#13=IFCBEAM('0AAAAAAAAAAAAAAAAAAAAA',$,'Beam',$,'IPE200',$,#12,$,.BEAM.);\n\
#14=IFCMAPPEDITEM(#8,#9);\n#15=IFCSHAPEREPRESENTATION(#3,'Body','MappedRepresentation',(#14));\n\
#16=IFCPRODUCTDEFINITIONSHAPE($,$,(#15));\n\
#17=IFCCOLUMN('0BBBBBBBBBBBBBBBBBBBBB',$,'Column',$,'IPE200',$,#16,$,.COLUMN.);\n\
#30=IFCCOLOURRGB($,0.,0.,1.);\n#31=IFCSURFACESTYLERENDERING(#30,0.,$,$,$,$,$,$,.NOTDEFINED.);\n\
#32=IFCSURFACESTYLE('Old blue',.BOTH.,(#31));\n#33=IFCSTYLEDITEM(#6,(#32),$);\n\
ENDSEC;\nEND-ISO-10303-21;\n");
    if schema.eq_ignore_ascii_case("IFC2X3") {
        content.replace(",$,.BEAM.);",",$);").replace(",$,.COLUMN.);",",$);").into_bytes()
    } else { content.into_bytes() }
}

fn request(rows: Vec<(Vec<u32>, [f64; 4])>) -> ColorizerRequest {
    ColorizerRequest { batches: rows.into_iter().map(|(products, color)| ColorizerBatch { products, color }).collect() }
}

#[test]
fn colorizer_gray_then_red_keeps_shared_occurrence_gray() {
    let source = fixture("IFC4");
    let gray = export_colorized_ifc(&source, &request(vec![(vec![13,17], [0.5,0.5,0.5,1.0])])).unwrap();
    let red = export_colorized_ifc(gray.as_bytes(), &request(vec![(vec![13], [1.0,0.0,0.0,1.0])])).unwrap();
    let catalog = catalog_colorizer(red.as_bytes(), &ColorizerGrouping::default()).unwrap();
    assert_eq!(catalog.product_ids, vec![13,17]);
    let mut decoder = EntityDecoder::new(&red);
    assert_eq!(decoder.decode_by_id(13).unwrap().get_string(2), Some("Beam"));
    assert_ne!(decoder.decode_by_id(13).unwrap().get_ref(6), decoder.decode_by_id(17).unwrap().get_ref(6));
    assert!(red.contains("IFCSURFACESTYLERENDERING"));
    assert_eq!(body_color(gray.as_bytes(),13),[0.5,0.5,0.5,1.]);
    assert_eq!(body_color(gray.as_bytes(),17),[0.5,0.5,0.5,1.]);
    assert_eq!(body_color(red.as_bytes(),13),[1.,0.,0.,1.]);
    assert_eq!(body_color(red.as_bytes(),17),[0.5,0.5,0.5,1.]);
}

#[test]
fn colorizer_rejects_overlapping_batches_and_nonfinite_channels() {
    let source = fixture("IFC4");
    assert!(export_colorized_ifc(&source, &request(vec![(vec![13], [1.,0.,0.,1.]), (vec![13], [0.,0.,0.,1.])])).is_err());
    assert!(export_colorized_ifc(&source, &request(vec![(vec![13], [f64::NAN,0.,0.,1.])])).is_err());
}

#[test]
fn colorizer_section_discovery_reads_the_shared_swept_profile() {
    let catalog = catalog_colorizer(&fixture("IFC4"), &ColorizerGrouping::default()).unwrap();
    assert_eq!(catalog.groups.len(), 1);
    assert_eq!(catalog.groups[0].name, "IPE200");
    assert_eq!(catalog.groups[0].products, vec![13,17]);
    assert_eq!(catalog.groups[0].source, "geometry profile");
}

#[test]
fn colorizer_single_pass_partitions_shared_geometry_and_preserves_unselected_style() {
    let source = fixture("IFC4");
    let selective = export_colorized_ifc(&source,&request(vec![(vec![13],[1.,0.,0.,1.])])).unwrap();
    assert_eq!(body_color(selective.as_bytes(),13),[1.,0.,0.,1.]);
    assert_eq!(body_color(selective.as_bytes(),17),[0.,0.,1.,1.]);
    let mixed = export_colorized_ifc(&source,&request(vec![(vec![13],[1.,0.,0.,1.]),(vec![17],[0.5,0.5,0.5,1.])])).unwrap();
    assert_eq!(body_color(mixed.as_bytes(),13),[1.,0.,0.,1.]);
    assert_eq!(body_color(mixed.as_bytes(),17),[0.5,0.5,0.5,1.]);
}

#[test]
fn colorizer_ifc2x3_uses_rendering_and_an_assignment_without_touching_shared_wrappers() {
    let source = String::from_utf8(fixture("IFC2X3")).unwrap()
        .replace("#33=IFCSTYLEDITEM(#6,(#32),$);", "#34=IFCPRESENTATIONSTYLEASSIGNMENT((#32));\n#33=IFCSTYLEDITEM(#6,(#34),$);");
    let result = export_colorized_ifc(source.as_bytes(),&request(vec![(vec![13],[1.,0.,0.,0.65])])).unwrap();
    let actual = body_color(result.as_bytes(),13);
    assert!((actual[3]-0.65).abs()<1e-12);
    assert_eq!(body_color(result.as_bytes(),17),[0.,0.,1.,1.]);
    let mut decoder=EntityDecoder::new(&result);
    assert_eq!(decoder.decode_by_id(34).unwrap().get_refs(0).unwrap(),vec![32]);
}

#[test]
fn colorizer_indexed_palette_is_detached_only_from_recoloured_surface() {
    let source = String::from_utf8(fixture("IFC4")).unwrap().replace(
        "#6=IFCEXTRUDEDAREASOLID(#5,#2,#4,3.);",
        "#6=IFCTRIANGULATEDFACESET(#50,$,.T.,((1,3,2),(1,2,4),(2,3,4),(3,1,4)),$);\n#50=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(1.,0.,0.),(0.,1.,0.),(0.,0.,1.)));\n#51=IFCCOLOURRGBLIST(((0.,1.,0.),(0.,0.,1.)));\n#52=IFCINDEXEDCOLOURMAP(#6,1.,#51,(1,2,1,2));");
    let selective=export_colorized_ifc(source.as_bytes(),&request(vec![(vec![13],[1.,0.,0.,1.])])).unwrap();
    let mut decoder=EntityDecoder::new(&selective);
    assert_eq!(decoder.decode_by_id(52).unwrap().get_ref(0),Some(body_leaf(selective.as_bytes(),17)));
    assert_ne!(body_leaf(selective.as_bytes(),13),6);
    let all=export_colorized_ifc(source.as_bytes(),&request(vec![(vec![13,17],[0.5,0.5,0.5,1.])])).unwrap();
    assert!(EntityDecoder::new(&all).decode_by_id(52).is_err());
    assert_eq!(body_color(all.as_bytes(),13),[0.5,0.5,0.5,1.]);
}

#[test]
fn colorizer_cyclic_representation_reports_failure_instead_of_truncated_success() {
    let source=String::from_utf8(fixture("IFC4")).unwrap().replace("#8=IFCREPRESENTATIONMAP(#2,#7);","#8=IFCREPRESENTATIONMAP(#2,#11);");
    assert!(catalog_colorizer(source.as_bytes(),&ColorizerGrouping::default()).unwrap_err().contains("Cyclic"));
    assert!(export_colorized_ifc(source.as_bytes(),&request(vec![(vec![13],[1.,0.,0.,1.])])).is_err());
}

#[test]
fn colorizer_attributes_follow_declared_schema_instead_of_the_last_slot() {
    let grouping = ColorizerGrouping { mode: GroupBy::Property, property: "@PredefinedType".into() };
    let catalog = catalog_colorizer(&fixture("IFC2X3"), &grouping).unwrap();
    assert_eq!(catalog.groups[0].name,"(Missing property)");
    assert_eq!(catalog.groups[0].products,vec![13,17]);
    let catalog = catalog_colorizer(&fixture("IFC4"), &grouping).unwrap();
    assert_eq!(catalog.groups.len(),2);
    assert!(catalog.groups.iter().any(|group| group.name == "BEAM" && group.products == [13]));
}

#[test]
fn colorizer_groups_material_storey_and_occurrence_property_over_type_default() {
    let source = String::from_utf8(fixture("IFC4")).unwrap().replace("ENDSEC;\nEND-ISO", "\
#40=IFCPROPERTYSINGLEVALUE('Section',$,IFCLABEL('TYPE'),$);\n\
#41=IFCPROPERTYSET('0CCCCCCCCCCCCCCCCCCCCC',$,'Pset_Test',$,(#40));\n\
#42=IFCBEAMTYPE('0DDDDDDDDDDDDDDDDDDDDD',$,'Beam type',$,$,(#41),$,$,$,.BEAM.);\n\
#43=IFCRELDEFINESBYTYPE('0EEEEEEEEEEEEEEEEEEEEE',$,$,$,(#13,#17),#42);\n\
#44=IFCPROPERTYSINGLEVALUE('Section',$,IFCLABEL('OCCURRENCE'),$);\n\
#45=IFCPROPERTYSET('0FFFFFFFFFFFFFFFFFFFFF',$,'Pset_Test',$,(#44));\n\
#46=IFCRELDEFINESBYPROPERTIES('0GGGGGGGGGGGGGGGGGGGGG',$,$,$,(#13),#45);\n\
#47=IFCMATERIAL('S355',$,$);\n\
#48=IFCRELASSOCIATESMATERIAL('0HHHHHHHHHHHHHHHHHHHHH',$,$,$,(#42),#47);\n\
#49=IFCBUILDINGSTOREY('0IIIIIIIIIIIIIIIIIIIII',$,'Level 1',$,$,$,$,$,.ELEMENT.,0.);\n\
#50=IFCRELCONTAINEDINSPATIALSTRUCTURE('0JJJJJJJJJJJJJJJJJJJJJ',$,$,$,(#13,#17),#49);\n\
ENDSEC;\nEND-ISO");
    let groups = catalog_colorizer(source.as_bytes(),&ColorizerGrouping {mode: GroupBy::Property,property:"Pset_Test.Section".into()}).unwrap().groups;
    assert!(groups.iter().any(|g| g.name == "OCCURRENCE" && g.products == [13]));
    assert!(groups.iter().any(|g| g.name == "TYPE" && g.products == [17]));
    let material = catalog_colorizer(source.as_bytes(),&ColorizerGrouping {mode: GroupBy::Material,property:String::new()}).unwrap();
    assert_eq!(material.groups[0].name,"S355");
    assert_eq!(material.groups[0].products,vec![13,17]);
    let storey = catalog_colorizer(source.as_bytes(),&ColorizerGrouping {mode: GroupBy::Storey,property:String::new()}).unwrap();
    assert_eq!(storey.groups[0].name,"Level 1");
    assert_eq!(storey.groups[0].products,vec![13,17]);
}
