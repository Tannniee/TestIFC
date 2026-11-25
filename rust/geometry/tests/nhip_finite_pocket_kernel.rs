// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Nhip 2026-10-25, real host #473164: finite edge cavities leave two
//! approximately 23.7 um skins. Closed operands must produce a closed solid.
//! The private exporter fixture stays outside committed source; fetch private
//! fixtures before running this independent exact-kernel reproduction.
#![cfg(feature="test-support")]
use ifc_lite_geometry::{kernel::{mesh_bridge,arrangement::box_mesh}, Mesh};
use ifc_lite_geometry::test_support::{subtract_finite_source,subtract_finite_source_many,union_finite_source};
use std::{collections::{HashMap,HashSet}, path::Path};

fn load(path: &Path, scale: f64) -> Mesh {
    let source = std::fs::read_to_string(path).expect("UTF-8 oracle fixture");
    let value: serde_json::Value = serde_json::from_str(&source).expect("oracle mesh JSON");
    let mut mesh = Mesh::new();
    for point in value["vertices"].as_array().expect("vertices") {
        for coordinate in point.as_array().expect("point") {
            mesh.positions.push((coordinate.as_f64().expect("coordinate") * scale) as f32);
        }
    }
    mesh.indices = value["indices"].as_array().expect("triangles").iter()
        .flat_map(|triangle| triangle.as_array().expect("triangle").iter())
        .map(|index| index.as_u64().expect("index") as u32).collect();
    mesh
}

fn defects(mesh: &Mesh) -> usize {
    let mut edges = HashMap::new();
    let points = mesh.positions.as_chunks::<3>().0;
    let key = |i: u32| points[i as usize].map(|v| if v == 0. { 0 } else { v.to_bits() });
    for triangle in mesh.indices.as_chunks::<3>().0 {
        let [a,b,c] = triangle.map(key);
        for (a,b) in [(a,b),(b,c),(c,a)] {
            let (edge,direction) = if a < b { ((a,b),1_i32) } else { ((b,a),-1_i32) };
            let value = edges.entry(edge).or_insert((0_usize,0_i32));
            value.0 += 1; value.1 += direction;
        }
    }
    let bad=edges.iter().filter(|(_, (count,balance))|*count!=2 || *balance!=0).collect::<Vec<_>>();
    if !bad.is_empty() && bad.len()<=12 { eprintln!("bad edges: {:?}",bad.iter().map(|((a,b),v)|([a.map(f32::from_bits),b.map(f32::from_bits)],v)).collect::<Vec<_>>()); }
    bad.len()
}

fn skin_hits(mesh: &Mesh, scale: f64, x: f64, y: f64) -> Vec<f64> {
    let points=mesh.positions.as_chunks::<3>().0;
    let mut hits=Vec::new();
    for triangle in mesh.indices.as_chunks::<3>().0 {
        let [a,b,c]=triangle.map(|i|points[i as usize].map(|v|f64::from(v)/scale));
        let (ab,ac)=([b[0]-a[0],b[1]-a[1]],[c[0]-a[0],c[1]-a[1]]);
        let determinant=ab[0]*ac[1]-ab[1]*ac[0];
        if determinant.abs()<1e-20 {continue;}
        let (dx,dy)=(x-a[0],y-a[1]);
        let u=(dx*ac[1]-dy*ac[0])/determinant;
        let v=(ab[0]*dy-ab[1]*dx)/determinant;
        if u>=-1e-9 && v>=-1e-9 && u+v<=1.+1e-9 {
            hits.push(a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]));
        }
    }
    hits.sort_by(f64::total_cmp);
    hits.dedup_by(|a,b|(*a-*b).abs()<1e-7);
    hits
}

fn volume(mesh: &Mesh) -> f64 {
    let points=mesh.positions.as_chunks::<3>().0;
    let center: [f64;3]=std::array::from_fn(|axis|points.iter().map(|p|f64::from(p[axis])).sum::<f64>()/points.len() as f64);
    mesh.indices.as_chunks::<3>().0.iter().map(|triangle|{
        let [a,b,c]=triangle.map(|i|std::array::from_fn::<_,3,_>(|axis|f64::from(points[i as usize][axis])-center[axis]));
        a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0])
    }).sum::<f64>().abs()/6.
}

fn components(mesh: &Mesh) -> usize {
    let points=mesh.positions.as_chunks::<3>().0;
    let key=|i:u32|points[i as usize].map(|v|if v==0. {0}else{v.to_bits()});
    let mut adjacency: HashMap<[u32;3],Vec<[u32;3]>>=HashMap::new();
    for triangle in mesh.indices.as_chunks::<3>().0 {
        let [a,b,c]=triangle.map(key);
        for (a,b) in [(a,b),(b,c),(c,a)] {
            adjacency.entry(a).or_default().push(b);adjacency.entry(b).or_default().push(a);
        }
    }
    let mut seen=HashSet::new();let mut count=0;
    for &start in adjacency.keys() {
        if !seen.insert(start){continue;}
        count+=1;let mut stack=vec![start];
        while let Some(vertex)=stack.pop(){for &next in &adjacency[&vertex]{if seen.insert(next){stack.push(next);}}}
    }
    count
}

fn boxed(lo: [f64;3], hi: [f64;3]) -> Mesh {
    mesh_bridge::tris_to_mesh(&box_mesh(lo,hi))
}

fn finite_stock() -> Mesh {
    let g=1./65536.;
    boxed([0.,0.,-10536.*g],[2581088.*g,1572865.*g,0.])
}

fn finite_pocket(offset: f64) -> Mesh {
    let g=1./65536.;
    boxed([(1258694.+offset)*g,1342177.*g,-10511.*g],
        [(1363552.+offset)*g,1572864.*g,-25.*g])
}

fn assert_two_skins(mesh: &Mesh, scale: f64, x: f64, y: f64) {
    let hits=skin_hits(mesh,scale,x,y);
    assert_eq!(hits.len(),4,"two stock skins require four z surfaces: {hits:?}");
    assert!((20e-6..27e-6).contains(&(hits[1]-hits[0])),"bottom skin: {hits:?}");
    assert!((20e-6..27e-6).contains(&(hits[3]-hits[2])),"top skin: {hits:?}");
}

#[test]
fn nhip_473164_closed_edge_pockets_preserve_both_blind_skins() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../research/nhip-fix-20261024/member-kernel");
    if !root.join("473164-oracle.json").is_file() {
        eprintln!("Skipping private Nhip #473164 reproduction; run pnpm fixtures and supply the private oracle operands in {}",root.display());
        return;
    }
    // Sixteen work units/metre puts the 23.7 um separation well beyond the
    // kernel's 8-grid near-coplanar band; no intended skin is tolerance noise.
    let scale = 16.;
    let mut stock = load(&root.join("473164-oracle.json"),scale);
    assert_eq!(defects(&stock),0,"oracle stock must be a closed input");
    for id in [473177,473183,473189] {
        let cutter = load(&root.join(format!("{id}-oracle.json")),scale);
        assert_eq!(defects(&cutter),0,"oracle cutter #{id} must be closed");
        let snapped_stock=mesh_bridge::tris_to_mesh(&mesh_bridge::mesh_to_tris(&stock));
        let snapped_cutter=mesh_bridge::tris_to_mesh(&mesh_bridge::mesh_to_tris(&cutter));
        assert_eq!(defects(&snapped_stock),0,"kernel snap broke stock before #{id}");
        assert_eq!(defects(&snapped_cutter),0,"kernel snap broke cutter #{id}");
        let next = subtract_finite_source(&stock,&cutter);
        assert!(!next.is_empty(),"finite pocket #{id} cannot consume this stock");
        assert_eq!(defects(&next),0,"closed-input difference tore at pocket #{id}");
        stock = next;
    }
    // Full IfcOpenShell Boolean treats these sub-Precision skins as coincident,
    // but the independently tessellated authored operands define a finite
    // cavity. Preserve BOTH skins rather than pinning that oracle limitation.
    assert_two_skins(&stock,16.,0.50038429,1.4);
}

#[test]
fn nhip_473164_one_grid_gap_is_not_a_coplanar_shared_interface() {
    // Reduced from the second pocket's failed cap. Every coordinate is an
    // exact multiple of the kernel grid; the cavity has a positive one-grid
    // gap to the outer Y face. No intersection exists on that parallel face.
    let stock=finite_stock();let cutter=finite_pocket(0.);
    let result=subtract_finite_source(&stock,&cutter);
    assert!(!result.is_empty());
    assert_eq!(defects(&result),0,
        "a positive cavity-to-exterior gap must keep its own boundary face");
    let expected=volume(&stock)-volume(&cutter);
    assert!((volume(&result)-expected).abs()<expected*1e-10);
    assert_two_skins(&result,16.,1.25,1.4);
}

#[test]
fn nhip_473164_batch_keeps_disjoint_finite_pockets_and_both_skins() {
    let stock=finite_stock();
    let a=finite_pocket(0.);let b=finite_pocket(786432.);
    let result=subtract_finite_source_many(&stock,&[&a,&b]).expect("closed disjoint finite pockets conform");
    assert!(!result.is_empty());assert_eq!(defects(&result),0);
    let expected=volume(&stock)-volume(&a)-volume(&b);
    assert!((volume(&result)-expected).abs()<expected*1e-10,"batch pocket volume");
    assert_two_skins(&result,16.,1.25,1.4);assert_two_skins(&result,16.,2.,1.4);
}

#[test]
fn nhip_source_union_removes_only_the_exact_touching_internal_face() {
    let a=boxed([0.,0.,0.],[1.,1.,1.]);let b=boxed([1.,0.,0.],[2.,1.,1.]);
    let result=union_finite_source(&[&a,&b]).expect("touching boxes have a finite union");
    assert_eq!(defects(&result),0);assert_eq!(components(&result),1);
    assert!((volume(&result)-2.).abs()<1e-12);
}

#[test]
fn nhip_source_union_retains_both_components_across_a_one_grid_gap() {
    let g=1./65536.;
    let a=boxed([0.,0.,0.],[1.,1.,1.]);let b=boxed([1.+g,0.,0.],[2.+g,1.,1.]);
    let result=union_finite_source(&[&a,&b]).expect("separated boxes retain both solids");
    assert_eq!(defects(&result),0);assert_eq!(components(&result),2);
    assert!((volume(&result)-2.).abs()<1e-12,"the positive gap must not be filled");
}

#[test]
fn nhip_source_union_owns_duplicate_boundary_faces_once() {
    let a=boxed([0.,0.,0.],[1.,1.,1.]);
    let result=union_finite_source(&[&a,&a]).expect("duplicate finite solid is idempotent");
    assert_eq!(defects(&result),0);assert_eq!(components(&result),1);
    assert!((volume(&result)-1.).abs()<1e-12);
}

#[test]
fn nhip_source_overlapping_finite_cavities_do_not_leave_internal_faces() {
    let stock=finite_stock();let a=finite_pocket(0.);let b=finite_pocket(52429.);
    let result=subtract_finite_source_many(&stock,&[&a,&b]).expect("finite overlapping cavities conform");
    assert_eq!(defects(&result),0,"overlapping cutters must not leave internal faces");
    let g=1./65536.;
    let overlap=boxed([1311123.*g,1342177.*g,-10511.*g],[1363552.*g,1572864.*g,-25.*g]);
    let expected=volume(&stock)-volume(&a)-volume(&b)+volume(&overlap);
    assert!((volume(&result)-expected).abs()<expected*1e-10,"overlapping pocket volume");
    assert_two_skins(&result,16.,1.3,1.4);
}

#[test]
fn nhip_473164_all_nine_overlapping_cuts_keep_closed_finite_stock() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../research/nhip-fix-20261024/member-kernel");
    if !root.join("473164-oracle.json").is_file() {
        eprintln!("Skipping private Nhip operands; run pnpm fixtures and supply the private oracle operands");
        return;
    }
    let stock=load(&root.join("473164-oracle.json"),256.);
    let cutters=[473177,473183,473189,473195,473201,473207,473217,473223,473229]
        .map(|id|load(&root.join(format!("{id}-oracle.json")),256.));
    let mut result=subtract_finite_source_many(&stock,&cutters.iter().collect::<Vec<_>>())
        .expect("nine finite cavities must conform in one arrangement");
    let mut physical_stock=stock.clone();
    for coordinate in &mut physical_stock.positions {*coordinate/=256.;}
    for coordinate in &mut result.positions {*coordinate/=256.;}
    let before=volume(&result);
    let result=ifc_lite_geometry::test_support::finish_finite_source(&physical_stock,result,0.0002)
        .expect("normal finite-source output must close in physical units");
    assert!((volume(&result)-before).abs()<before*0.001,"hygiene must preserve material volume");
    assert!(!result.is_empty());assert_eq!(defects(&result),0);
    assert!(volume(&result)<volume(&stock));
    assert_two_skins(&result,1.,0.50038429,1.4);
}
