use ifc_lite_processing::{process_geometry_filtered_with_quality_and_ids,OpeningFilterMode,TessellationQuality};
use std::{collections::HashSet,time::Instant};
fn main(){
    let args:Vec<_>=std::env::args().collect();
    let source=std::fs::read(&args[1]).unwrap();
    let ids:HashSet<u32>=args[3].split(',').map(|s|s.parse().unwrap()).collect();
    let start=Instant::now();
    let result=ifc_lite_processing::run_on_geometry_pool(||process_geometry_filtered_with_quality_and_ids(
        &source,OpeningFilterMode::Default,TessellationQuality::Medium,Some(&ids))).unwrap();
    let seconds=start.elapsed().as_secs_f64();
    serde_json::to_writer_pretty(std::fs::File::create(&args[2]).unwrap(),&serde_json::json!({
        "seconds":seconds,"stats":result.stats,"meshes":result.meshes
    })).unwrap();
    println!("meshes {} seconds {seconds}",result.meshes.len());
}
