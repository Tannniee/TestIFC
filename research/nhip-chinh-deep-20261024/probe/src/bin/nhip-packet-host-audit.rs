use ifc_lite_processing::{process_geometry_filtered_with_quality_and_ids, OpeningFilterMode, TessellationQuality};
use std::{collections::HashSet,time::Instant};

// Exercise the real desktop conversion; the other wire encoders are not used
// by this research census, so their intentional dead-code warnings are scoped.
#[allow(dead_code)]
#[path="F:/Steel/VBA/IFC-Lite-Core104/desktop/src-tauri/src/packet.rs"]
mod packet;
#[allow(dead_code)]
#[path="nhip-void-host-audit.rs"]
mod census;

fn main() {
    let args:Vec<_>=std::env::args().collect();
    let source=std::fs::read(&args[1]).unwrap();
    let ids:HashSet<u32>=std::fs::read_to_string(&args[2]).unwrap().split_whitespace().map(|s|s.parse().unwrap()).collect();
    let start=Instant::now();
    let result=ifc_lite_processing::run_on_geometry_pool(||process_geometry_filtered_with_quality_and_ids(
        &source,OpeningFilterMode::Default,TessellationQuality::Medium,Some(&ids))).unwrap();
    let basis=ifc_lite_processing::native_to_baked(result.frame.coordinate_space(),result.site_transform.as_deref(),[0.;3]);
    let rows:Vec<_>=result.meshes.iter().map(|original|{
        let mut mesh=original.clone();packet::restore_world_axes(&mut mesh,&basis);
        serde_json::json!({"id":mesh.express_id,"triangles":mesh.indices.len()/3,
            "canonicalTopology":census::topology(&original.positions,&original.indices),
            "packetTopology":census::topology(&mesh.positions,&mesh.indices)})
    }).collect();
    let bad:Vec<_>=rows.iter().filter(|r|r["packetTopology"].as_object().unwrap().values().any(|n|n.as_u64()!=Some(0))).collect();
    let value=serde_json::json!({"source":args[1],"selectedHosts":ids.len(),"meshes":rows.len(),
        "seconds":start.elapsed().as_secs_f64(),"stats":result.stats,"badPackets":bad,"rows":rows});
    serde_json::to_writer(std::fs::File::create(&args[3]).unwrap(),&value).unwrap();
    println!("{}",serde_json::json!({"meshes":value["meshes"],"seconds":value["seconds"],"badPackets":value["badPackets"]}));
}
