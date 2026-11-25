#[test]
fn diagnose_current_common_plane_temporarily() {
    let source=std::fs::read_to_string("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-plate-150461/minimal-original.ifc").unwrap();
    for id in [150461,152785] {
        let mut decoder=EntityDecoder::new(&source);let host=decoder.decode_by_id(id).unwrap();
        let mut router=GeometryRouter::with_scale_and_local_frame(0.001,false);router.set_rtc_offset((563237.05656001,1100360.68735001,0.0));
        let ids=if id==150461 {std::iter::once(150479).chain((150485..=150551).step_by(6)).collect::<Vec<_>>()}else{std::iter::once(152789).chain((152793..=152837).step_by(4)).collect::<Vec<_>>()};
        let solid=router.host_extruded_solid(&host,&mut decoder).unwrap();let r=solid.m.fixed_view::<3,3>(0,0);eprintln!("HOST {id} PROFILE {} HOLES {} GRAM {}",solid.profile.outer.len(),solid.profile.holes.len(),(r.transpose()*r-Matrix3::identity()).amax());
        let cut=router.capture_common_plane_cut(&host,&ids,&mut decoder);eprintln!("CAPTURE {}",cut.is_some());
        if let Some(cut)=cut {
            let mesh=router.process_element(&host,&mut decoder).unwrap();eprintln!("RECONCILE {} VOL {} PREC {:?}",reconciles(&mesh,&cut),mesh_signed_volume(&mesh),cut.boundary_precision);
            let p=subtract_multiple_2d_all(&cut.host_profile,&cut.footprints);eprintln!("PROFILES {:?}",p.as_ref().map(|p|p.iter().map(|p|(p.outer.len(),p.holes.len())).collect::<Vec<_>>()));
            if let Ok(ref p)=p {eprintln!("INITIAL_EMIT {}",router.emit_thin_profiles(&cut,p).is_some());}
            let revised=retry::regularize(&cut);eprintln!("REGULARIZE {}",revised.is_some());
            if let Some((f,envelope))=revised {let revised=subtract_multiple_2d_all(&cut.host_profile,&f);eprintln!("REVISED {:?}",revised.as_ref().map(|p|p.iter().map(|p|(p.outer.len(),p.holes.len())).collect::<Vec<_>>()));if let Ok(ref p2)=revised {eprintln!("DELTA {} ENVELOPE {} EMIT {}",profile_area(p.as_ref().unwrap())-profile_area(p2),envelope,router.emit_thin_profiles(&cut,p2).is_some());for profile in p2 {
                    let mut part=extrude_profile_watertight(profile,cut.depth,None).unwrap();eprintln!("CDT {:?} RAW {} {} {}",crate::cdt::triangulate_constrained(&profile.outer,&profile.holes).map(|(p,i)|(p.len(),i.len()/3)),part.triangle_count(),param_cut_watertight(&part),retry::closed_manifold(&part));
                    let value=serde_json::json!({"outer":profile.outer.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>(),"holes":profile.holes.iter().map(|h|h.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>()).collect::<Vec<_>>(),"positions":part.positions,"indices":part.indices});std::fs::write(format!("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-plate-150461/revised-{id}.json"),serde_json::to_string(&value).unwrap()).unwrap();
                    let mut wt=cut.wt;for i in 0..3{wt[(i,3)]=0.0;}apply_transform(&mut part,&wt);part.clean_degenerate();eprintln!("POST {} {} {}",part.triangle_count(),param_cut_watertight(&part),retry::closed_manifold(&part));
                }}}
            eprintln!("FINAL {}",router.try_thin_box_cut(&mesh,&cut).is_some());
        }
    }
}
