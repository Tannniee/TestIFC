use ifc_lite_processing::{process_geometry_filtered_with_quality_and_ids, OpeningFilterMode, TessellationQuality};
use std::{collections::{HashMap,HashSet}, time::Instant};

pub(crate) fn topology(positions:&[f32],indices:&[u32])->serde_json::Value {
    let points=positions.as_chunks::<3>().0;
    let mut edges=HashMap::<([u32;3],[u32;3]),(usize,i32)>::new();
    let mut collapsed=0;
    for triangle in indices.as_chunks::<3>().0 {
        let p=triangle.map(|i|points[i as usize].map(f64::from));
        let ab=std::array::from_fn::<_,3,_>(|i|p[1][i]-p[0][i]);
        let ac=std::array::from_fn::<_,3,_>(|i|p[2][i]-p[0][i]);
        let cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
        collapsed+=usize::from(cross.iter().all(|v|*v==0.));
        let keys=triangle.map(|i|points[i as usize].map(|v|if v==0.{0}else{v.to_bits()}));
        for i in 0..3 {
            let (a,b)=(keys[i],keys[(i+1)%3]);
            let (edge,direction)=if a<b {((a,b),1)}else{((b,a),-1)};
            let value=edges.entry(edge).or_default();value.0+=1;value.1+=direction;
        }
    }
    serde_json::json!({"unpairedOrNonmanifoldEdges":edges.values().filter(|v|v.0!=2).count(),
        "directedMismatch":edges.values().filter(|v|v.1!=0).count(),"collapsedTriangles":collapsed})
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let source = std::fs::read(&args[1]).expect("read source IFC");
    let selection = std::fs::read_to_string(&args[2]).expect("read selected host ids");
    let ids: HashSet<u32> = selection.split_whitespace().map(|s| s.parse().expect("express id")).collect();
    let start = Instant::now();
    let result = ifc_lite_processing::run_on_geometry_pool(|| {
        process_geometry_filtered_with_quality_and_ids(&source, OpeningFilterMode::Default,
            TessellationQuality::Medium, Some(&ids))
    }).expect("canonical geometry pool");
    let rows: Vec<_> = result.meshes.iter().map(|m| serde_json::json!({
        "id":m.express_id,"type":m.ifc_type,"triangles":m.indices.len()/3,
        "topology":topology(&m.positions,&m.indices)
    })).collect();
    let value = serde_json::json!({"source":args[1],"selectedHosts":ids.len(),
        "seconds":start.elapsed().as_secs_f64(),"stats":result.stats,"summary":rows});
    serde_json::to_writer(std::fs::File::create(&args[3]).expect("audit output"), &value).expect("audit JSON");
    println!("{}", serde_json::json!({"hosts":ids.len(),"seconds":value["seconds"],
        "failures":value["stats"]["total_csg_failures"],"failedHosts":value["stats"]["products_with_failures"]}));
}
