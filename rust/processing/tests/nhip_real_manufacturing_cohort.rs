// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Nhip 2026-10-24: private Tekla manufacturing regression. The original IFC
//! is never committed. Synthetic invariants cover CI without private data.
use ifc_lite_processing::{process, ProcessingRequest, TessellationQuality};
use std::{collections::{HashMap,HashSet},path::PathBuf};

#[test]
fn nhip_real_body_cuts_preserve_closed_stock_and_member_material() {
    let Some(path)=std::env::var_os("IFC_LITE_NHIP_MODEL").map(PathBuf::from) else {
        eprintln!("skip: private Tekla fixture absent; set IFC_LITE_NHIP_MODEL. Use pnpm fixtures for public fixtures.");return;
    };
    if !path.is_file(){eprintln!("skip: IFC_LITE_NHIP_MODEL is absent; use pnpm fixtures for public fixtures.");return;}
    let source=std::fs::read(path).expect("read supplied private fixture");
    let ids=HashSet::from([178955,281338,448868,460997,490757,464047,472872,809515,817569,818684,
        824437,825013,830064,831471,831549,836117,836248,837397,842718,845196,845414,473164,473277,473789,473865,471627,473024,473532,
        257768,258582,258648,286665,286744,286882,286961,287038,292599,
        15785,89056,178623,198892,248619,10217,714937,
        618305,704523,615144,647471,679523,725690,566424,665548,625141,319371]);
    let result=ifc_lite_processing::run_on_geometry_pool(||process(
        &source, &ProcessingRequest::full_pass().quality(TessellationQuality::Medium).ids(Some(std::sync::Arc::new(ids.clone()))), &mut ())).expect("native geometry pool");
    assert_eq!(result.meshes.len(),ids.len(),"no host is silently dropped");
    assert_eq!(result.stats.total_csg_failures,0);
    for mesh in &result.meshes {
        let key=|i:u32|std::array::from_fn::<_,3,_>(|axis|{
            let p=mesh.positions[i as usize*3+axis];assert!(p.is_finite());if p==0. {0}else{p.to_bits()}
        });
        let mut edges=HashMap::<([u32;3],[u32;3]),(usize,i32)>::new();
        for tri in mesh.indices.as_chunks::<3>().0 {
            for i in 0..3 {
                let (a,b)=(key(tri[i]),key(tri[(i+1)%3]));assert_ne!(a,b,"host {} has a collapsed stored edge",mesh.express_id);
                let (edge,sense)=if a<b {((a,b),1)}else{((b,a),-1)};
                let count=edges.entry(edge).or_default();count.0+=1;count.1+=sense;
            }
        }
        assert!(!edges.is_empty());assert!(edges.values().all(|&v|v==(2,0)),"host {} has an open or multiply used edge",mesh.express_id);
    }
    let member=result.meshes.iter().find(|m|m.express_id==281338).unwrap();
    let p=|i:u32|std::array::from_fn::<_,3,_>(|k|f64::from(member.positions[i as usize*3+k]));
    let volume=member.indices.as_chunks::<3>().0.iter().map(|t|{
        let [a,b,c]=t.map(p);a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0])
    }).sum::<f64>().abs()/6.;
    let reference=0.09226341295335559;
    assert!((volume-reference).abs()/reference<0.001,"member volume {volume} vs independent reference {reference}");
}
