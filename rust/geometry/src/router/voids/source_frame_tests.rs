use super::*;

// Nhip precision scope: even an unwinding speculative operation must not leave
// a host-relative placement in a warm decoder's world-placement memo.
#[test]
fn nhip_unwinding_precision_scope_restores_real_geometry_on_a_warm_decoder() {
    let source="#1=IFCCARTESIANPOINT((0.,0.,0.));\n#2=IFCAXIS2PLACEMENT3D(#1,$,$);\n\
        #3=IFCCARTESIANPOINT((30.,20.,10.));\n#4=IFCAXIS2PLACEMENT3D(#3,$,$);\n\
        #5=IFCLOCALPLACEMENT($,#4);\n#6=IFCDIRECTION((0.,0.,1.));\n\
        #7=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,1.,1.);\n\
        #8=IFCEXTRUDEDAREASOLID(#7,#2,#6,1.);\n\
        #9=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#8));\n\
        #10=IFCPRODUCTDEFINITIONSHAPE($,$,(#9));\n\
        #100=IFCPLATE('0000000000000000000100',$,$,$,$,#5,#10,$,.NOTDEFINED.);\n";
    let mut decoder=EntityDecoder::new(source);
    let host=decoder.decode_by_id(100).unwrap();
    let router=GeometryRouter::with_scale_and_local_frame(1.,false);
    let before=router.process_element_parts(&host,&mut decoder).unwrap();
    let failed=std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut cache=FxHashMap::default();
        cache.insert(5,*Matrix4::<f64>::identity().as_slice().first_chunk::<16>().unwrap());
        let mut scope=MemoScope::new(&mut decoder,cache);
        let local=router.process_element_parts(&host,&mut scope).unwrap();
        assert_ne!(local[0].positions,before[0].positions);
        panic!("intentional speculative unwind");
    }));
    assert!(failed.is_err());
    let after=router.process_element_parts(&host,&mut decoder).unwrap();
    assert_eq!(before[0].positions,after[0].positions);
    assert_eq!(before[0].local_to_world,after[0].local_to_world);
}

#[test]
fn nhip_remaining_three_manufacturing_hosts_have_a_valid_source_frame() {
    let Some(path)=std::env::var_os("IFC_LITE_NHIP_MODEL") else {
        eprintln!("skip: private Tekla model absent; set IFC_LITE_NHIP_MODEL; public fixtures use pnpm fixtures");return;
    };
    let source=std::fs::read(path).expect("private fixture");
    let mut decoder=EntityDecoder::new(&source);
    let router=GeometryRouter::with_units(&source,&mut decoder);
    let mut index=FxHashMap::<u32,Vec<u32>>::default();
    let mut scanner=ifc_lite_core::EntityScanner::new(&source);
    while let Some((id,kind,_,_))=scanner.next_entity(){
        if kind.eq_ignore_ascii_case("IFCRELVOIDSELEMENT") {
            let relation=decoder.decode_by_id(id).unwrap();
            if let (Some(host),Some(cutter))=(relation.get_ref(4),relation.get_ref(5)){index.entry(host).or_default().push(cutter);}
        }
    }
    let mut refused=Vec::new();
    let ids=std::env::var("IFC_LITE_NHIP_DIAG_ID").ok().map(|id|vec![id.parse::<u32>().expect("diagnostic id")]).unwrap_or_else(||vec![10217,198892,714937]);
    for id in ids {
        let host=decoder.decode_by_id(id).unwrap();
        let extrusion=router.host_extruded_solid(&host,&mut decoder).unwrap();
        let rotation=extrusion.m.fixed_view::<3,3>(0,0);
        eprintln!("#{id} orthogonality={} det={} profile={}",(rotation.transpose()*rotation-nalgebra::Matrix3::identity()).amax(),rotation.determinant(),extrusion.profile.outer.len());
        let plan=router.source_frame_plan(&host,&index[&id],&mut decoder);
        eprintln!("#{id} plan={}",plan.is_some());
        if plan.is_none(){refused.push(id);continue;}
        let frame=plan.unwrap().0;
        let result=router.try_source_frame(&host,&mut decoder,&index,|local,decoder|{
            if local.precision_frame.is_some() {
                if let Some(path)=std::env::var_os("IFC_LITE_NHIP_OPERAND_DUMP") {
                    let mut rows=Vec::new();
                    for product_id in std::iter::once(id).chain(index[&id].iter().copied()) {
                        let product=decoder.decode_by_id(product_id).unwrap();
                        let mut operands=local.process_element_parts_with_hygiene(&product,decoder,super::super::SourceHygiene::IndexOnly)?;
                        for mesh in &mut operands {super::super::source_hygiene::repair_closed_input(mesh,local.precision_frame.unwrap());}
                        eprintln!("operand #{product_id}: {:?}",operands.iter().map(|mesh|(mesh.triangle_count(),precision_seams::closed_manifold(mesh))).collect::<Vec<_>>());
                        for mesh in operands {rows.push(serde_json::json!({"id":product_id,"positions":mesh.positions,"indices":mesh.indices,"origin":mesh.origin}));}
                    }
                    std::fs::write(path,serde_json::to_vec(&rows).unwrap()).expect("private diagnostic mesh dump");
                }
            }
            let parts=local.process_element_with_voids_parts(&host,decoder,&index)?;
            eprintln!("#{id} exact={} csg={} parts={}",local.precision_frame.is_some(),local.csg_failures.borrow().len(),parts.len());
            for mesh in &parts {
                let mut world=mesh.clone();router.restore_precision_mesh(&mut world,&frame);
                if local.precision_frame.is_some() {
                    if let Some(path)=std::env::var_os("IFC_LITE_NHIP_RESULT_DUMP") {
                        let row=|m:&Mesh|serde_json::json!({"positions":m.positions,"indices":m.indices,"origin":m.origin});
                        std::fs::write(path,serde_json::to_vec(&serde_json::json!({"local":row(mesh),"world":row(&world)})).unwrap()).expect("private result dump");
                    }
                }
                super::super::source_hygiene::clean(&mut world);
                eprintln!("#{id} inner={} world={} world_repair={}",precision_seams::closed_manifold(mesh),precision_seams::closed_manifold(&world),precision_seams::close_with_precision(&mut world,0.0002));
            }
            Ok(parts)
        });
        if result.is_none(){refused.push(id);}
    }
    assert!(refused.is_empty(),"valid finite manufacturing hosts must keep a source-frame cut: {refused:?}");
}
