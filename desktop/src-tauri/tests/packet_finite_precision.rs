// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Nhip 2026-10-26: the final desktop basis rotation must not reopen a closed
//! boundary that the canonical producer already validated (#287038/#319371).
use ifc_lite_desktop::packet::restore_world_axes;
use ifc_lite_geometry::{calculate_normals,Mesh};
use ifc_lite_processing::MeshData;
use std::collections::HashMap;

fn assert_closed(mesh:&MeshData) {
    let points=mesh.positions.as_chunks::<3>().0;
    let mut edges=HashMap::<([u32;3],[u32;3]),(u32,i32)>::new();
    for tri in mesh.indices.as_chunks::<3>().0 {
        let p=tri.map(|i|points[i as usize].map(f64::from));
        let ab=std::array::from_fn::<_,3,_>(|i|p[1][i]-p[0][i]);
        let ac=std::array::from_fn::<_,3,_>(|i|p[2][i]-p[0][i]);
        assert!(ab[1]*ac[2]-ab[2]*ac[1]!=0. || ab[2]*ac[0]-ab[0]*ac[2]!=0. || ab[0]*ac[1]-ab[1]*ac[0]!=0.,"packet rotation collapsed a boundary face");
        let keys=tri.map(|i|points[i as usize].map(|v|if v==0.{0}else{v.to_bits()}));
        for i in 0..3 {
            let (a,b)=(keys[i],keys[(i+1)%3]);let (key,sense)=if a<b {((a,b),1)}else{((b,a),-1)};
            let value=edges.entry(key).or_default();value.0+=1;value.1+=sense;
        }
    }
    assert!(!edges.is_empty());
    assert!(edges.values().all(|v|*v==(2,0)),"packet boundary must retain paired opposite edges");
}

#[test]
fn rotated_tetrahedron_retains_its_material_after_a_subdivision_endpoint_collapses() {
    let mut geometry=Mesh::new();
    geometry.positions=vec![-1.5,-2.5,-3.5, 0.5,-2.5,-3.5, -1.5,-0.5,-3.5,
        -1.5,-2.5,-1.5, (-1.5_f32).next_up(),-2.5,-3.5];
    geometry.indices=vec![0,2,4,4,2,1,0,4,3,4,1,3,1,2,3,0,3,2];
    calculate_normals(&mut geometry);
    let mut mesh=MeshData::new(1,"IfcMember".into(),geometry.positions,geometry.normals,geometry.indices,[1.;4]);
    assert_closed(&mesh);
    let (sx,cx)=5_f64.to_radians().sin_cos();let (sy,cy)=15_f64.to_radians().sin_cos();
    let basis=[cy,0.,-sy,0., sy*sx,cx,cy*sx,0., sy*cx,-sx,cy*cx,0., 0.,0.,0.,1.];
    restore_world_axes(&mut mesh,&basis);
    assert_closed(&mesh);
}

#[test]
fn nhip_canonical_meshes_survive_the_actual_desktop_packet_basis() {
    let Some(path)=std::env::var_os("IFCLITE_NHIP_PACKET_FIXTURE") else {
        eprintln!("skip private packet fixture; set IFCLITE_NHIP_PACKET_FIXTURE; catalogued fixtures use pnpm fixtures");return;
    };
    let data:serde_json::Value=serde_json::from_slice(&std::fs::read(path).expect("private canonical mesh capture")).unwrap();
    let basis:Vec<f64>=data["siteTransform"].as_array().unwrap().iter().map(|v|v.as_f64().unwrap()).collect();
    let basis:&[f64;16]=basis.as_slice().try_into().unwrap();
    for row in data["meshes"].as_array().unwrap() {
        let floats=|key:&str|row[key].as_array().unwrap().iter().map(|v|v.as_f64().unwrap() as f32).collect();
        let indices=row["indices"].as_array().unwrap().iter().map(|v|v.as_u64().unwrap() as u32).collect();
        let mut mesh=MeshData::new(row["express_id"].as_u64().unwrap() as u32,"IfcMember".into(),floats("positions"),floats("normals"),indices,[1.;4]);
        mesh.origin=std::array::from_fn(|i|row["origin"][i].as_f64().unwrap());
        assert_closed(&mesh);
        restore_world_axes(&mut mesh,basis);
        assert_closed(&mesh);
    }
}
