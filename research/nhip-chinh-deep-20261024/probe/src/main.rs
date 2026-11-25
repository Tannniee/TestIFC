use ifc_lite_processing::{process_geometry_filtered_with_quality_and_ids, OpeningFilterMode, TessellationQuality};
use std::{collections::HashSet, time::Instant};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let source = std::fs::read(&args[1]).expect("research input read");
    let ids: HashSet<u32> = args[2].split(',').map(|s| s.parse().expect("express id")).collect();
    eprintln!("SOURCE {} bytes; IDS {:?}", source.len(), ids);
    let start = Instant::now();
    let result = ifc_lite_processing::run_on_geometry_pool(|| {
        process_geometry_filtered_with_quality_and_ids(&source, OpeningFilterMode::Default, TessellationQuality::Medium, Some(&ids))
    }).expect("geometry pool");
    let elapsed = start.elapsed().as_secs_f64();
    let rows: Vec<_> = result.meshes.iter().map(|m| serde_json::json!({"id":m.express_id,"type":m.ifc_type,"name":m.name,"triangles":m.indices.len()/3,"color":m.color,"origin":m.origin})).collect();
    eprintln!("FINISHED {} seconds: {} meshes, {} triangles", elapsed, rows.len(), result.meshes.iter().map(|m|m.indices.len()/3).sum::<usize>());
    let value = serde_json::json!({"source":args[1],"ids":ids,"seconds":elapsed,"meshes":result.meshes,"metadata":result.metadata,"stats":result.stats,"siteTransform":result.site_transform,"buildingTransform":result.building_transform,"summary":rows,"csgCensus":format!("{:?}",ifc_lite_geometry::csg::take_csg_census())});
    serde_json::to_writer(std::fs::File::create(&args[3]).expect("research output"),&value).expect("serialize research result");
    println!("{}",serde_json::to_string_pretty(&value["summary"]).unwrap());
}
