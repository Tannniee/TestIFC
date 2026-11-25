#[test]
fn diagnose_remaining_nhip_box_temporarily() {
    let source = std::fs::read_to_string(r"F:\Steel\VBA\IFC-Lite-Core104\research\nhip-fix-20261024\remaining-body-298390\minimal-original.ifc").unwrap();
    for local in [false, true] {
        let mut decoder = EntityDecoder::new(&source);
        let host = decoder.decode_by_id(298390).unwrap();
        let mut router = GeometryRouter::with_scale_and_local_frame(0.001, local);
        router.set_rtc_offset((563237.05656001,1100360.68735001,0.0));
        let ids=(298394..=298474).step_by(4).collect::<Vec<_>>();
        let solid=router.host_extruded_solid(&host,&mut decoder).unwrap();
        eprintln!("LOCAL {local} PROFILE {} {:?} cleanbox {}",solid.profile.outer.len(),solid.profile.outer,clean_box(&solid,0.001,router.rtc_offset).is_some());
        let cut=router.capture_thin_box_cut(&host,&ids,&mut decoder);
        eprintln!("CAPTURE {}",cut.is_some());
        if let Some(mut cut)=cut {
            let mesh=router.process_element(&host,&mut decoder).unwrap();
            eprintln!("RECONCILE {} tris {} volume {}",reconciles(&mesh,&cut),mesh.triangle_count(),mesh_signed_volume(&mesh));
            let profiles=subtract_multiple_2d_all(&cut.host_profile,&cut.footprints);
            eprintln!("DIFFERENCE {:?}",profiles.as_ref().map(|p|p.len()));
            if let Ok(profiles)=profiles {for profile in profiles {
                eprintln!("CDT {:?}",crate::cdt::triangulate_constrained(&profile.outer,&profile.holes).map(|(p,i)|(p.len(),i.len()/3)));
                let mut part=extrude_profile_watertight(&profile,cut.depth,None).unwrap();
                eprintln!("EXTRUDE ({},{},{}) AREA {} HOLES {}",part.triangle_count(),param_cut_watertight(&part),super::super::super::geom::mesh_is_closed_exact(&part),compute_signed_area(&profile.outer),profile.holes.len());
                let value=serde_json::json!({"outer":profile.outer.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>(),"holes":profile.holes.iter().map(|h|h.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>()).collect::<Vec<_>>(),"positions":part.positions,"indices":part.indices});
                std::fs::write("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-body-298390/planar-extrude.json",serde_json::to_string(&value).unwrap()).unwrap();
                let mut tight=part.clone();tight.clean_degenerate_watertight(); eprintln!("WATERTIGHT_HYGIENE ({},{},{})",tight.triangle_count(),param_cut_watertight(&tight),super::super::super::geom::mesh_is_closed_exact(&tight));
                part.clean_degenerate();
                let clean=serde_json::json!({"positions":part.positions,"indices":part.indices});std::fs::write("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-body-298390/planar-extrude-clean.json",serde_json::to_string(&clean).unwrap()).unwrap();
                eprintln!("CLEAN ({},{},{})",part.triangle_count(),param_cut_watertight(&part),super::super::super::geom::mesh_is_closed_exact(&part));
                let mut wt=cut.wt;for i in 0..3{wt[(i,3)]=0.0;} apply_transform(&mut part,&wt); part.clean_degenerate();
                eprintln!("TRANSFORM ({},{},{})",part.triangle_count(),param_cut_watertight(&part),super::super::super::geom::mesh_is_closed_exact(&part));
            }}
            eprintln!("FINAL {}",router.try_thin_box_cut(&mesh,&cut).is_some());
            let original=cut.footprints.clone();
            let h=cut.host_profile.outer[2];let tol=2.5e-7+cut.depth*1e-6;
            for fp in &mut cut.footprints {for p in fp {for i in 0..2 {for boundary in [-h[i],h[i]] {if(p[i]-boundary).abs()<=tol {p[i]=boundary;}}}}}
            let snapped=router.try_thin_box_cut(&mesh,&cut);eprintln!("BOUNDARY_SNAP {:?}",snapped.as_ref().map(|p|(p.triangle_count(),mesh_signed_volume(p),param_cut_watertight(p))));
            cut.footprints=original.clone();
            let mut moved=0;
            for fp in &mut cut.footprints {for p in fp {for i in 0..2 {for boundary in [-h[i],h[i]] {
                let b=boundary as f32;let ulp=(f32::from_bits(b.abs().to_bits()+1)-b.abs()) as f64;
                if p[i] as f32==b {(p[i])=boundary+boundary.signum()*(ulp*4.0).min(1e-6);moved+=1;}
            }}}}
            let prof=subtract_multiple_2d_all(&cut.host_profile,&cut.footprints);eprintln!("OUTWARD_PROFILES {:?}",prof.as_ref().map(|p|p.len()));
            if let Ok(profiles)=prof {for profile in profiles {
                eprintln!("OUTWARD_CDT {:?}",crate::cdt::triangulate_constrained(&profile.outer,&profile.holes).map(|(p,i)|(p.len(),i.len()/3)));
                let mut part=extrude_profile_watertight(&profile,cut.depth,None).unwrap();
                let expected=(compute_signed_area(&profile.outer).abs()-profile.holes.iter().map(|h|compute_signed_area(h).abs()).sum::<f64>())*cut.depth;
                eprintln!("OUTWARD_RAW ({},{},{}) VOLUME {} EXPECTED {}",part.triangle_count(),super::super::super::geom::topology_defect_count(&part),super::super::super::geom::mesh_is_closed_exact(&part),mesh_signed_volume(&part),expected);
                let mut wt=cut.wt;for i in 0..3{wt[(i,3)]=0.0;} apply_transform(&mut part,&wt); 
                let value=serde_json::json!({"outer":profile.outer.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>(),"holes":profile.holes.iter().map(|h|h.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>()).collect::<Vec<_>>(),"positions":part.positions,"indices":part.indices,"origin":[cut.wt[(0,3)],cut.wt[(1,3)],cut.wt[(2,3)]]});std::fs::write("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-body-298390/outward-raw-rotated.json",serde_json::to_string(&value).unwrap()).unwrap();
                let mut tight=part.clone();tight.clean_degenerate_watertight();eprintln!("OUTWARD_TIGHT ({},{},{})",tight.triangle_count(),super::super::super::geom::topology_defect_count(&tight),super::super::super::geom::mesh_is_closed_exact(&tight));
                tight.clean_degenerate();eprintln!("OUTWARD_TIGHT_THEN_CLEAN ({},{},{})",tight.triangle_count(),super::super::super::geom::topology_defect_count(&tight),super::super::super::geom::mesh_is_closed_exact(&tight));
                part.clean_degenerate();
                eprintln!("OUTWARD_FINAL ({},{},{}) VOLUME {}",part.triangle_count(),super::super::super::geom::topology_defect_count(&part),super::super::super::geom::mesh_is_closed_exact(&part),mesh_signed_volume(&part));
            }}
            let snapped=router.try_thin_box_cut(&mesh,&cut);eprintln!("ULP_OUTWARD {moved} {:?}",snapped.as_ref().map(|p|(p.triangle_count(),mesh_signed_volume(p),param_cut_watertight(p))));
            cut.footprints=original.clone();let grid=crate::kernel::mesh_bridge::SNAP_GRID;let mut moved=0;
            for fp in &mut cut.footprints {for i in 0..2 {for sign in [-1.0,1.0] {
                let boundary=sign*h[i];let outside=fp.iter().map(|p|sign*(p[i]-boundary)).fold(f64::NEG_INFINITY,f64::max);
                let inside=outside<0.0;
                for p in fp.iter_mut() {
                    let gap=sign*(p[i]-boundary);
                    if inside && gap > -2.0*grid {p[i]=boundary-sign*2.0*grid;moved+=1;}
                    else if !inside && gap.abs()<grid {p[i]=boundary+sign*grid;moved+=1;}
                }
            }}}
            let snapped=router.try_thin_box_cut(&mesh,&cut);eprintln!("GRID_CLEARANCE {moved} {:?}",snapped.as_ref().map(|p|(p.triangle_count(),mesh_signed_volume(p),param_cut_watertight(p),super::super::super::geom::mesh_is_closed_exact(p))));
            cut.footprints=original;let mut moved=0;
            for fp in &mut cut.footprints {for p in fp {for i in 0..2 {for sign in [-1.0,1.0] {
                let boundary=sign*h[i];if(p[i]-boundary).abs()<=grid {p[i]=boundary+sign*grid;moved+=1;}
            }}}}
            let snapped=router.try_thin_box_cut(&mesh,&cut);eprintln!("GRID_OUTWARD {moved} {:?}",snapped.as_ref().map(|p|(p.triangle_count(),mesh_signed_volume(p),param_cut_watertight(p),super::super::super::geom::mesh_is_closed_exact(p))));
            if let Some(ref p)=snapped {let value=serde_json::json!({"positions":p.positions,"indices":p.indices,"origin":p.origin});std::fs::write("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-body-298390/candidate-grid-outward.json",serde_json::to_string(&value).unwrap()).unwrap();}
            
            if let Some(ref p)=snapped {let value=serde_json::json!({"positions":p.positions,"indices":p.indices,"origin":p.origin});std::fs::write("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-body-298390/candidate-grid.json",serde_json::to_string(&value).unwrap()).unwrap();}
            
            if let Some(ref p)=snapped {let value=serde_json::json!({"positions":p.positions,"indices":p.indices,"origin":p.origin});std::fs::write("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-body-298390/candidate-outward.json",serde_json::to_string(&value).unwrap()).unwrap();}
            
            if let Some(ref p)=snapped {let value=serde_json::json!({"positions":p.positions,"indices":p.indices,"origin":p.origin});std::fs::write("F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fix-20261024/remaining-body-298390/candidate-snapped.json",serde_json::to_string(&value).unwrap()).unwrap();}
        }
    }
}

