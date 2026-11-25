// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Nhip 2026-10-24: oblique subtraction must remain oblique, even when native
//! world f32 coordinates would lose the thin stock's face planes.
use ifc_lite_processing::{process_geometry, MeshData};
use std::collections::HashMap;

fn fixture() -> String {
    let (s, c) = 0.02_f64.sin_cos();
    let mut source = format!(r#"ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Synthetic oblique-cut invariant'),'2;1');
FILE_NAME('oblique.ifc','2026-10-24T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCDIRECTION((0.,0.,1.));
#4=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#5=IFCUNITASSIGNMENT((#4));
#6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.0002,#2,$);
#7=IFCPROJECT('0000000000000000000001',$,'P',$,$,$,$,(#6),#5);
#10=IFCCARTESIANPOINT((617.,383.,71.));
#11=IFCDIRECTION((0.3,0.4,0.8660254037844386));
#12=IFCDIRECTION((0.8,-0.6,0.));
#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);
#14=IFCLOCALPLACEMENT($,#13);
#20=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,2.,3.);
#21=IFCEXTRUDEDAREASOLID(#20,#2,#3,0.01);
#22=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#21));
#23=IFCPRODUCTDEFINITIONSHAPE($,$,(#22));
#100=IFCPLATE('0000000000000000000100',$,'Thin stock',$,$,#14,#23,$,.NOTDEFINED.);
#30=IFCCARTESIANPOINT((0.,0.,-0.1));
#31=IFCDIRECTION(({s},0.,{c}));
#32=IFCDIRECTION(({c},0.,-{s}));
#33=IFCAXIS2PLACEMENT3D(#30,#31,#32);
#34=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,0.4,0.6);
#35=IFCEXTRUDEDAREASOLID(#34,#33,#3,0.2);
#36=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#35));
#37=IFCPRODUCTDEFINITIONSHAPE($,$,(#36));
#200=IFCVOIDINGFEATURE('0000000000000000000200',$,'Oblique hole',$,$,#14,#37,$,.HOLE.);
#201=IFCRELVOIDSELEMENT('0000000000000000000201',$,$,$,#100,#200);
"#);
    let (sn,cn) = 0.005_f64.sin_cos();
    let ring = (0..32).map(|i|{let a=f64::from(i)*std::f64::consts::TAU/32.;format!("({},{})",0.1*a.cos(),0.1*a.sin())}).collect::<Vec<_>>().join(",");
    let indices = (1..=32).map(|i|i.to_string()).collect::<Vec<_>>().join(",");
    source.push_str(&format!("#63=IFCCARTESIANPOINTLIST2D(({ring}));\n#64=IFCINDEXEDPOLYCURVE(#63,(IFCLINEINDEX(({indices},1))),$);\n#60=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#64);\n#61=IFCDIRECTION(({sn},0.,{cn}));\n#62=IFCDIRECTION(({cn},0.,-{sn}));\n"));
    for (index,(x,y)) in [-1.,1.].into_iter().flat_map(|x|[-1.,0.,1.].into_iter().map(move |y|(x,y))).enumerate() {
        let id = 300+index*10;
        source.push_str(&format!("#{id}=IFCCARTESIANPOINT(({x},{y},-0.1));\n\
            #{}=IFCAXIS2PLACEMENT3D(#{id},#61,#62);\n\
            #{}=IFCEXTRUDEDAREASOLID(#60,#{},#3,0.2);\n\
            #{}=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#{}));\n\
            #{}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{}));\n\
            #{}=IFCVOIDINGFEATURE('000000000000000000{:04}',$,'Notch',$,$,#14,#{},$,.HOLE.);\n\
            #{}=IFCRELVOIDSELEMENT('000000000000000000{:04}',$,$,$,#100,#{});\n",
            id+1,id+2,id+1,id+3,id+2,id+4,id+3,id+5,id+5,id+4,id+6,id+6,id+5));
    }
    source.push_str("ENDSEC;\nEND-ISO-10303-21;\n");
    source
}

fn assert_closed(mesh: &MeshData) {
    let mut edges = HashMap::<([u32; 3], [u32; 3]), (u32, i32)>::new();
    let key = |index: u32| std::array::from_fn(|axis| {
        let value = mesh.positions[index as usize * 3 + axis];
        if value == 0.0 { 0 } else { value.to_bits() }
    });
    for tri in mesh.indices.as_chunks::<3>().0 {
        for i in 0..3 {
            let (a,b) = (key(tri[i]),key(tri[(i+1)%3]));
            assert_ne!(a,b);
            let (edge,sense) = if a < b { ((a,b),1) } else { ((b,a),-1) };
            let count = edges.entry(edge).or_default(); count.0 += 1; count.1 += sense;
        }
    }
    assert!(!edges.is_empty());
    assert!(edges.values().all(|&value| value == (2,0)), "stored mesh has unpaired or inconsistently wound edges");
}

fn volume_of(mesh:&MeshData)->f64 {
    let p=mesh.positions.as_chunks::<3>().0.iter().map(|p|p.map(f64::from)).collect::<Vec<_>>();
    let center:[f64;3]=std::array::from_fn(|axis|p.iter().map(|v|v[axis]).sum::<f64>()/p.len() as f64);
    mesh.indices.as_chunks::<3>().0.iter().map(|tri| {
        let [a,b,c]=tri.map(|i|std::array::from_fn::<_,3,_>(|axis|p[i as usize][axis]-center[axis]));
        a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0])
    }).sum::<f64>().abs()/6.
}

fn frustum_fixture()->String {
    let mut source=fixture().split("#20=").next().unwrap().to_owned();
    source.push_str("#20=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,10.,15.);\n#21=IFCEXTRUDEDAREASOLID(#20,#2,#3,6.1);\n#22=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#21));\n#23=IFCPRODUCTDEFINITIONSHAPE($,$,(#22));\n#100=IFCFOOTING('0000000000000000000100',$,'Frustum stock',$,$,#14,#23,$,.NOTDEFINED.);\n");
    for index in 0..4 {
        let axis=index/2; let positive=index%2==0;
        let half=if axis==0 {5.}else{7.5}; let slope=if axis==0 {1./6.1}else{2./6.1};
        let mut points=Vec::new();
        for z in [-1.,7.] {
            let inner=half-slope*z;
            let (x0,x1,y0,y1)=if axis==0 {
                if positive {(inner,20.,-20.,20.)}else{(-20.,-inner,-20.,20.)}
            }else if positive {(-20.,20.,inner,20.)}else{(-20.,20.,-20.,-inner)};
            points.extend([[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]]);
        }
        let id=300+index*20;
        let coords=points.iter().map(|p|format!("({},{},{})",p[0],p[1],p[2])).collect::<Vec<_>>().join(",");
        source.push_str(&format!("#{id}=IFCCARTESIANPOINTLIST3D(({coords}));\n"));
        let mut faces=Vec::new();
        for (offset,face) in ["1,4,3,2","5,6,7,8","1,2,6,5","2,3,7,6","3,4,8,7","4,1,5,8"].iter().enumerate(){
            let face_id=id+offset+1;faces.push(format!("#{face_id}"));
            source.push_str(&format!("#{face_id}=IFCINDEXEDPOLYGONALFACE(({face}));\n"));
        }
        source.push_str(&format!("#{}=IFCPOLYGONALFACESET(#{id},.T.,({}),$);\n#{}=IFCSHAPEREPRESENTATION(#6,'Body','Tessellation',(#{}));\n#{}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{}));\n#{}=IFCVOIDINGFEATURE('000000000000000000{:04}',$,'Wedge',$,$,#14,#{},$,.CUTOUT.);\n#{}=IFCRELVOIDSELEMENT('000000000000000000{:04}',$,$,$,#100,#{});\n",
            id+7,faces.join(","),id+8,id+7,id+9,id+8,id+10,id+10,id+9,id+11,id+11,id+10));
    }
    source.push_str("ENDSEC;\nEND-ISO-10303-21;\n");
    source
}

#[test]
fn nhip_polygonal_cutters_preserve_analytic_footing_frustum_in_world_frame() {
    let source=frustum_fixture();
    let result=process_geometry(source.as_bytes());
    assert_eq!(result.stats.total_csg_failures,0);
    let meshes=result.meshes.iter().filter(|m|m.express_id==100).collect::<Vec<_>>();
    assert_eq!(meshes.len(),1);
    assert_closed(meshes[0]);
    // Integral_0^6.1 (10-2z/6.1)(15-4z/6.1) dz.
    let expected=6.1*(150.-35.+8./3.);
    let actual=volume_of(meshes[0]);
    assert!((actual-expected).abs()/expected<1e-4,"frustum volume: {actual} vs {expected}; {:?}",result.stats.geometry_diagnostics);
}

#[test]
fn nhip_closed_polygonal_cutter_with_one_reversed_face_keeps_its_real_shape() {
    let source=frustum_fixture().replace("#301=IFCINDEXEDPOLYGONALFACE((1,4,3,2));","#301=IFCINDEXEDPOLYGONALFACE((2,3,4,1));");
    let result=process_geometry(source.as_bytes());
    assert_eq!(result.stats.total_csg_failures,0);
    let mesh=result.meshes.iter().find(|m|m.express_id==100).unwrap();assert_closed(mesh);
    let expected=6.1*(150.-35.+8./3.);
    assert!((volume_of(mesh)-expected).abs()/expected<1e-4);
}

#[test]
fn nhip_host_frame_does_not_poison_a_warm_decoder_or_the_next_uncut_mesh() {
    use ifc_lite_core::{EntityDecoder,EntityScanner};
    use ifc_lite_geometry::GeometryRouter;
    let source=fixture();
    let mut decoder=EntityDecoder::new(&source);
    let router=GeometryRouter::with_scale_and_local_frame(1.,false);
    let host=decoder.decode_by_id(100).unwrap();
    let before=router.process_element_parts(&host,&mut decoder).unwrap();
    let mut index=rustc_hash::FxHashMap::default();
    let mut scanner=EntityScanner::new(source.as_bytes());
    let mut ids=Vec::new();
    while let Some((id,name,_,_))=scanner.next_entity(){if name.eq_ignore_ascii_case("IFCVOIDINGFEATURE"){ids.push(id);}}
    index.insert(100,ids);
    let cut=router.process_element_with_voids_parts(&host,&mut decoder,&index).unwrap();
    assert!(!cut.is_empty());
    let after=router.process_element_parts(&host,&mut decoder).unwrap();
    assert_eq!(before.len(),after.len());
    for (a,b) in before.iter().zip(after){
        assert_eq!(a.positions,b.positions,"speculative placement memo leaked into later geometry");
        assert_eq!(a.origin,b.origin);
        assert_eq!(a.local_to_world,b.local_to_world);
    }
}

#[test]
fn nhip_blind_manufacturing_pocket_is_not_extended_through_the_plate() {
    let prefix=fixture();
    let source=prefix.split("#63=").next().unwrap().lines().map(|line| {
        if line.starts_with("#30=") { "#30=IFCCARTESIANPOINT((0.,0.,0.006));".to_owned() }
        else if line.starts_with("#31=") { "#31=IFCDIRECTION((0.,0.,1.));".to_owned() }
        else if line.starts_with("#32=") { "#32=IFCDIRECTION((1.,0.,0.));".to_owned() }
        else if line.starts_with("#35=") { "#35=IFCEXTRUDEDAREASOLID(#34,#33,#3,0.014);".to_owned() }
        else { line.to_owned() }
    }).collect::<Vec<_>>().join("\n")+"\nENDSEC;\nEND-ISO-10303-21;\n";
    let result=process_geometry(source.as_bytes());
    assert_eq!(result.stats.total_csg_failures,0);
    let mesh=result.meshes.iter().find(|mesh|mesh.express_id==100).unwrap();
    assert_closed(mesh);
    let expected=6.*0.01-0.4*0.6*0.004;
    // The kernel quantizes BOTH stock caps to its 15.3 um grid. Bound that
    // volume noise by surface area * grid; a false through-hole exceeds it.
    let budget=12.11/65536.; // documented kernel grid, in metres
    assert!((volume_of(mesh)-expected).abs()<budget,"a 4 mm pocket must leave 6 mm of stock: {} vs {expected}",volume_of(mesh));
}

#[test]
fn nhip_oblique_cut_preserves_bevel_and_material_after_host_frame_round_trip() {
    let result = process_geometry(fixture().as_bytes());
    assert_eq!(result.stats.total_csg_failures, 0, "a real oblique cutter must not be dropped");
    let meshes = result.meshes.iter().filter(|m| m.express_id == 100).collect::<Vec<_>>();
    assert_eq!(meshes.len(),1);
    let mesh = meshes[0];
    assert_closed(mesh);
    let shift = result.metadata.coordinate_info.origin_shift;
    let axes = [[0.8,-0.6,0.0],[0.5196152422706631,0.6928203230275509,-0.5],[0.3,0.4,0.8660254037844386]];
    let points = mesh.positions.as_chunks::<3>().0.iter().map(|p| {
        let world: [f64;3] = std::array::from_fn(|i| f64::from(p[i])+mesh.origin[i]+shift[i]-[617.,383.,71.][i]);
        axes.map(|axis| axis.iter().zip(world).map(|(a,b)|a*b).sum::<f64>())
    }).collect::<Vec<_>>();
    let volume = mesh.indices.as_chunks::<3>().0.iter().map(|t| {
        let [a,b,c] = t.map(|i|points[i as usize]);
        a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0])
    }).sum::<f64>().abs()/6.;
    // Opposite notches have identical offsets. Their two clipped ellipses
    // complement one another at EVERY stock depth, giving one full ellipse.
    let polygon_area = 16.*0.1_f64.powi(2)*(std::f64::consts::TAU/32.).sin();
    let expected = (6.-0.4*0.6/0.02_f64.cos()-3.*polygon_area/0.005_f64.cos())*0.01;
    assert!((volume-expected).abs()/expected < 0.001, "analytic oblique-prism volume: {volume} vs {expected}");
    let normals = mesh.normals.as_chunks::<3>().0.iter().map(|n|
        axes.map(|axis|axis.iter().zip(n).map(|(a,b)|a*f64::from(*b)).sum::<f64>())).collect::<Vec<_>>();
    let left = |z:f64| points.iter().zip(&normals).filter(|(p,n)|p[0].abs()<0.5 && n[0]>0.99 && n[2].abs()<0.1 && (p[2]-z).abs()<3e-5)
        .map(|(p,_)|p[0]).min_by(f64::total_cmp).expect("hole side's cap vertices");
    let drift = left(0.01)-left(0.0);
    assert!((drift-0.01*0.02_f64.tan()).abs()<5e-5, "oblique side was flattened: cap drift {drift}");
}

#[test]
fn nhip_boundary_through_prefix_preserves_a_genuinely_oblique_residual_hole() {
    let (sn,cn)=0.005_f64.sin_cos();
    let source=fixture().replace(&format!("#61=IFCDIRECTION(({sn},0.,{cn}));"),"#61=IFCDIRECTION((0.,0.,1.));")
        .replace(&format!("#62=IFCDIRECTION(({cn},0.,-{sn}));"),"#62=IFCDIRECTION((1.,0.,0.));");
    let result=process_geometry(source.as_bytes());
    let mesh=result.meshes.iter().find(|m|m.express_id==100).expect("stock survives");
    assert_eq!(result.stats.total_csg_failures,0);
    assert_closed(mesh);
    let polygon_area=16.*0.1_f64.powi(2)*(std::f64::consts::TAU/32.).sin();
    let expected=(6.-0.4*0.6/0.02_f64.cos()-3.*polygon_area)*0.01;
    assert!((volume_of(mesh)-expected).abs()/expected<0.001,"parallel edge notches plus finite oblique cut: {} vs {expected}",volume_of(mesh));
}

#[test]
fn nhip_circular_pocket_preserves_a_47_micron_blind_skin() {
    let source=fixture().split("#63=").next().unwrap().lines().map(|line|{
        if line.starts_with("#30="){"#30=IFCCARTESIANPOINT((0.,0.,0.000047));".to_owned()}
        else if line.starts_with("#31="){"#31=IFCDIRECTION((0.,0.,1.));".to_owned()}
        else if line.starts_with("#32="){"#32=IFCDIRECTION((1.,0.,0.));".to_owned()}
        else if line.starts_with("#34="){"#34=IFCCIRCLEPROFILEDEF(.AREA.,$,$,0.1);".to_owned()}
        else if line.starts_with("#35="){"#35=IFCEXTRUDEDAREASOLID(#34,#33,#3,0.014);".to_owned()}
        else{line.to_owned()}
    }).collect::<Vec<_>>().join("\n")+"\nENDSEC;\nEND-ISO-10303-21;\n";
    let result=process_geometry(source.as_bytes());assert_eq!(result.stats.total_csg_failures,0);
    let mesh=result.meshes.iter().find(|m|m.express_id==100).unwrap();assert_closed(mesh);
    let shift=result.metadata.coordinate_info.origin_shift;
    let axes=[[0.8,-0.6,0.],[0.5196152422706631,0.6928203230275509,-0.5],[0.3,0.4,0.8660254037844386]];
    let points=mesh.positions.as_chunks::<3>().0.iter().map(|p|{
        let world:[f64;3]=std::array::from_fn(|i|f64::from(p[i])+mesh.origin[i]+shift[i]-[617.,383.,71.][i]);
        axes.map(|axis|axis.iter().zip(world).map(|(a,b)|a*b).sum::<f64>())
    }).collect::<Vec<_>>();
    let mut hits=Vec::new();
    for t in mesh.indices.as_chunks::<3>().0 {
        let [a,b,c]=t.map(|i|points[i as usize]);
        let (ab,ac,ap)=([b[0]-a[0],b[1]-a[1]],[c[0]-a[0],c[1]-a[1]],[0.013-a[0],0.027-a[1]]);
        let det=ab[0]*ac[1]-ab[1]*ac[0];if det.abs()<1e-20{continue;}
        let u=(ap[0]*ac[1]-ap[1]*ac[0])/det;let v=(ab[0]*ap[1]-ab[1]*ap[0])/det;
        if u>=-1e-9 && v>=-1e-9 && u+v<=1.+1e-9{hits.push(a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]));}
    }
    hits.sort_by(f64::total_cmp);hits.dedup_by(|a,b|(*a-*b).abs()<1e-6);
    assert_eq!(hits.len(),2,"a blind circular pocket leaves TWO skin surfaces: {hits:?}");
    let thickness=hits[1]-hits[0];
    assert!((35e-6..60e-6).contains(&thickness),"blind skin is {thickness} m, not a through-hole or full stock");
}

#[test]
fn nhip_finite_cavity_keeps_both_24_micron_skins_through_the_final_mesh_funnel() {
    let stock_depth=0.01004735;
    let skin=(stock_depth-0.01)/2.;
    let mut source=fixture().split("#63=").next().unwrap().lines().map(|line|{
        if line.starts_with("#21="){format!("#21=IFCEXTRUDEDAREASOLID(#20,#2,#3,{stock_depth});")}
        else if line.starts_with("#30="){format!("#30=IFCCARTESIANPOINT((0.,0.,{skin}));")}
        else if line.starts_with("#31="){"#31=IFCDIRECTION((0.,0.,1.));".to_owned()}
        else if line.starts_with("#32="){"#32=IFCDIRECTION((1.,0.,0.));".to_owned()}
        else if line.starts_with("#34="){"#34=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#64);".to_owned()}
        else if line.starts_with("#35="){"#35=IFCEXTRUDEDAREASOLID(#34,#33,#3,0.01);".to_owned()}
        else{line.to_owned()}
    }).collect::<Vec<_>>().join("\n");
    let ring=(0..32).map(|i|{let a=f64::from(i)*std::f64::consts::TAU/32.;format!("({},{})",0.1*a.cos(),0.1*a.sin())}).collect::<Vec<_>>().join(",");
    let indices=(1..=32).map(|i|i.to_string()).collect::<Vec<_>>().join(",");
    source.push_str(&format!("\n#63=IFCCARTESIANPOINTLIST2D(({ring}));\n#64=IFCINDEXEDPOLYCURVE(#63,(IFCLINEINDEX(({indices},1))),$);\nENDSEC;\nEND-ISO-10303-21;\n"));
    let result=process_geometry(source.as_bytes());
    assert_eq!(result.stats.total_csg_failures,0);
    assert_eq!(result.stats.degenerate_triangles_dropped,0,"a valid finite boundary must survive the final backstop");
    let mesh=result.meshes.iter().find(|m|m.express_id==100).expect("stock survives");
    assert_closed(mesh);
    let polygon_area=16.*0.1_f64.powi(2)*(std::f64::consts::TAU/32.).sin();
    let expected=6.*stock_depth-polygon_area*0.01;
    assert!((volume_of(mesh)-expected).abs()<5e-6,"the inner cavity must subtract material, including after orientation");
    let shift=result.metadata.coordinate_info.origin_shift;
    let axes=[[0.8,-0.6,0.],[0.5196152422706631,0.6928203230275509,-0.5],[0.3,0.4,0.8660254037844386]];
    let points=mesh.positions.as_chunks::<3>().0.iter().map(|p|{
        let world:[f64;3]=std::array::from_fn(|i|f64::from(p[i])+mesh.origin[i]+shift[i]-[617.,383.,71.][i]);
        axes.map(|axis|axis.iter().zip(world).map(|(a,b)|a*b).sum::<f64>())
    }).collect::<Vec<_>>();
    let mut hits=Vec::new();
    for tri in mesh.indices.as_chunks::<3>().0 {
        let [a,b,c]=tri.map(|i|points[i as usize]);let ab=[b[0]-a[0],b[1]-a[1]];let ac=[c[0]-a[0],c[1]-a[1]];
        let ap=[0.013-a[0],0.027-a[1]];let det=ab[0]*ac[1]-ab[1]*ac[0];if det.abs()<1e-20{continue;}
        let u=(ap[0]*ac[1]-ap[1]*ac[0])/det;let v=(ab[0]*ap[1]-ab[1]*ap[0])/det;
        if u>=-1e-9 && v>=-1e-9 && u+v<=1.+1e-9 {hits.push(a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]));}
    }
    hits.sort_by(f64::total_cmp);hits.dedup_by(|a,b|(*a-*b).abs()<1e-6);
    assert_eq!(hits.len(),4,"two blind skins have four physical boundary surfaces: {hits:?}");
    for thickness in [hits[1]-hits[0],hits[3]-hits[2]] {
        assert!((20e-6..27e-6).contains(&thickness),"finite stock skin: {thickness}");
    }
}
