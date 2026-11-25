use ifc_lite_processing::{process, ProcessingRequest, TessellationQuality};
use std::{collections::HashSet,time::Instant};
#[allow(dead_code)]
#[path="F:/Steel/VBA/IFC-Lite-Upgrade20261105/desktop/src-tauri/src/packet.rs"] mod packet;
#[allow(dead_code)]
#[path="F:/Steel/VBA/IFC-Lite-Upgrade20261105/apps/server/src/services/axis.rs"] mod axis;
fn main(){
    let args:Vec<_>=std::env::args().collect();
    let source=std::fs::read(&args[1]).unwrap();
    let ids:HashSet<u32>=args[3].split(',').map(|s|s.parse().unwrap()).collect();
    let start=Instant::now();
    let result=ifc_lite_processing::run_on_geometry_pool(||process(
        &source, &ProcessingRequest::full_pass().quality(TessellationQuality::Medium).ids(Some(std::sync::Arc::new(ids))), &mut ())).unwrap();
    let seconds=start.elapsed().as_secs_f64();
    let basis=result.frame.baked_basis;
    let mut wire=result.meshes.clone();
    for mesh in &mut wire { packet::restore_world_axes(mesh, &basis); axis::mesh_to_yup_in_place(mesh); }

    serde_json::to_writer_pretty(std::fs::File::create(&args[2]).unwrap(),&serde_json::json!({
        "seconds":seconds,"stats":result.stats,"meshes":wire,"sourceMeshes":result.meshes,"metadata":result.metadata,"bakedBasis":basis
    })).unwrap();
    println!("meshes {} seconds {seconds}",result.meshes.len());
}
