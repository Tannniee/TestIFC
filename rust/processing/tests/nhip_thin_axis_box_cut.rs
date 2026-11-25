// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Regression for the 2026-10-24 Nhip chinh investigation, Body host #2444.
//! A plate is authored as a long extrusion, but every cutter goes through its
//! thin axis. Interior rounded holes, boundary notches, and a splitting slot
//! have an independent planar-area oracle; no original model data is embedded.

use ifc_lite_processing::{process_geometry, MeshData};
use std::collections::{HashMap, HashSet};

const THICKNESS: f64 = 0.016;
const WIDTH: f64 = 2.46;
const LENGTH: f64 = 3.114;

fn rounded_hole() -> Vec<[f64; 2]> {
    let mut points = Vec::new();
    for (cx, cy, degrees) in [
        (0.53, 0.7, 270.0_f64),
        (0.53, 2.414, 0.0),
        (-0.53, 2.414, 90.0),
        (-0.53, 0.7, 180.0),
    ] {
        for step in 0..=16 {
            let angle = (degrees + f64::from(step) * 90.0 / 16.0).to_radians();
            points.push([cx + 0.2 * angle.cos(), cy + 0.2 * angle.sin()]);
        }
    }
    points
}

fn polygon_area(points: &[[f64; 2]]) -> f64 {
    points.iter().zip(points.iter().cycle().skip(1)).take(points.len())
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum::<f64>().abs() * 0.5
}

fn expected_volume(split: bool) -> f64 {
    // Four quarter-circle corner notches remove one complete regular 32-gon.
    let circle = (0..32).map(|i| {
        let a = f64::from(i) * std::f64::consts::TAU / 32.0;
        [0.035 * a.cos(), 0.035 * a.sin()]
    }).collect::<Vec<_>>();
    // The middle slot overlaps the rounded hole across width 1.46 m, so its
    // additional removed area is 0.1 m * (2.46 - 1.46) m, not its whole area.
    let slot_extra = if split { 0.1 * (WIDTH - 1.46) } else { 0.0 };
    THICKNESS * (WIDTH * LENGTH - polygon_area(&rounded_hole()) - polygon_area(&circle) - slot_extra)
}

fn fixture(split: bool) -> String {
    // The site anchor and tilted host force real frame/RTC composition. The
    // plate still has exact analytic box dimensions in its own frame.
    let mut out = String::from(r#"ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Synthetic thin-axis plate invariant'),'2;1');
FILE_NAME('thin-axis.ifc','2026-10-24T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCLOCALPLACEMENT($,#2);
#4=IFCDIRECTION((0.,0.,1.));
#5=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#6=IFCUNITASSIGNMENT((#5));
#7=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-7,#2,$);
#8=IFCPROJECT('0000000000000000000001',$,'P',$,$,$,$,(#7),#6);
#9=IFCCARTESIANPOINT((1000000.,2000000.,0.));
#10=IFCAXIS2PLACEMENT3D(#9,$,$);
#11=IFCLOCALPLACEMENT($,#10);
#12=IFCSITE('0000000000000000000002',$,'S',$,$,#11,$,$,.ELEMENT.,$,$,$,$,$);
#13=IFCCARTESIANPOINT((16.,86.,56.));
#14=IFCDIRECTION((0.7966496318,0.0312806458,-0.6036314151));
#15=IFCDIRECTION((0.4771486302,0.5805057096,0.6598047483));
#16=IFCAXIS2PLACEMENT3D(#13,#14,#15);
#17=IFCLOCALPLACEMENT(#11,#16);
#18=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,0.016,2.46);
#19=IFCEXTRUDEDAREASOLID(#18,#2,#4,3.114);
#20=IFCSHAPEREPRESENTATION(#7,'Body','SweptSolid',(#19));
#21=IFCPRODUCTDEFINITIONSHAPE($,$,(#20));
#100=IFCMEMBER('0000000000000000000003',$,'Plate',$,$,#17,#21,$,.NOTDEFINED.);
#22=IFCCARTESIANPOINT((-0.016,0.,0.));
#23=IFCDIRECTION((1.,0.,0.));
#24=IFCDIRECTION((0.,1.,0.));
#25=IFCAXIS2PLACEMENT3D(#22,#23,#24);
"#);
    let mut contours = vec![rounded_hole()];
    for (y, z) in [(-1.23, 0.0), (1.23, 0.0), (-1.23, LENGTH), (1.23, LENGTH)] {
        contours.push((0..32).map(|step| {
            let angle = f64::from(step) * std::f64::consts::TAU / 32.0;
            [y + 0.035 * angle.cos(), z + 0.035 * angle.sin()]
        }).collect());
    }
    if split {
        contours.push(vec![[-1.4, 1.507], [1.4, 1.507], [1.4, 1.607], [-1.4, 1.607]]);
    }
    for (index, points) in contours.iter().enumerate() {
        let id = 200 + index * 8;
        let coordinates = points.iter().map(|p| format!("({:.12},{:.12})", p[0], p[1]))
            .collect::<Vec<_>>().join(",");
        let loop_indices = (1..=points.len()).map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        out.push_str(&format!(
            "#{id}=IFCCARTESIANPOINTLIST2D(({coordinates}));\n\
             #{}=IFCINDEXEDPOLYCURVE(#{id},(IFCLINEINDEX(({loop_indices},1))),$);\n\
             #{}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#{});\n",
            id + 1, id + 2, id + 1,
        ));
        out.push_str(&format!(
            "#{}=IFCEXTRUDEDAREASOLID(#{},#25,#4,0.032);\n\
             #{}=IFCSHAPEREPRESENTATION(#7,'Body','SweptSolid',(#{}));\n\
             #{}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{}));\n\
             #{}=IFCVOIDINGFEATURE('000000000000000000{:04}',$,'Cut',$,$,#17,#{},$,.HOLE.);\n\
             #{}=IFCRELVOIDSELEMENT('000000000000000000{:04}',$,$,$,#100,#{});\n",
            id + 3, id + 2, id + 4, id + 3, id + 5, id + 4,
            id + 6, id + 6, id + 5, id + 7, id + 7, id + 6,
        ));
    }
    out.push_str("ENDSEC;\nEND-ISO-10303-21;\n");
    out
}

fn vertices(mesh: &MeshData) -> Vec<[f64; 3]> {
    mesh.positions.as_chunks::<3>().0.iter().map(|v| std::array::from_fn(|i| f64::from(v[i]) + mesh.origin[i])).collect()
}

fn volume(meshes: &[&MeshData]) -> f64 {
    meshes.iter().map(|mesh| {
        let v = vertices(mesh);
        let center: [f64; 3] = std::array::from_fn(|i| v.iter().map(|p| p[i]).sum::<f64>() / v.len() as f64);
        mesh.indices.as_chunks::<3>().0.iter().map(|t| {
            let p = [t[0], t[1], t[2]].map(|i| std::array::from_fn::<_, 3, _>(|k| v[i as usize][k] - center[k]));
            p[0][0] * (p[1][1]*p[2][2] - p[1][2]*p[2][1])
                + p[0][1] * (p[1][2]*p[2][0] - p[1][0]*p[2][2])
                + p[0][2] * (p[1][0]*p[2][1] - p[1][1]*p[2][0])
        }).sum::<f64>().abs() / 6.0
    }).sum()
}

fn connected_components(meshes: &[&MeshData]) -> usize {
    let mut ids = HashMap::<[i64; 3], usize>::new();
    let mut graph = Vec::<HashSet<usize>>::new();
    for mesh in meshes {
        let v = vertices(mesh);
        for triangle in mesh.indices.as_chunks::<3>().0 {
            let keys = [triangle[0], triangle[1], triangle[2]].map(|i| {
                // 0.1 mm welding tolerates stored f32 error at this RTC anchor;
                // all intentional openings and the 100 mm split are much wider.
                v[i as usize].map(|c| (c * 10_000.0).round() as i64)
            });
            let tri = keys.map(|key| *ids.entry(key).or_insert_with(|| { graph.push(HashSet::new()); graph.len() - 1 }));
            for i in 0..3 {
                graph[tri[i]].insert(tri[(i + 1) % 3]);
                graph[tri[(i + 1) % 3]].insert(tri[i]);
            }
        }
    }
    let mut seen = HashSet::new();
    let mut components = 0;
    for root in 0..graph.len() {
        if !seen.insert(root) { continue; }
        components += 1;
        let mut pending = vec![root];
        while let Some(id) = pending.pop() {
            for &next in &graph[id] {
                if seen.insert(next) { pending.push(next); }
            }
        }
    }
    components
}

fn check(split: bool) {
    let source = fixture(split);
    let result = process_geometry(source.as_bytes());
    let hosts = result.meshes.iter().filter(|m| m.express_id == 100).collect::<Vec<_>>();
    assert!(!hosts.is_empty(), "the plate must survive its boundary cuts");
    let expected = expected_volume(split);
    let actual = volume(&hosts);
    assert!((actual - expected).abs() < 2e-5, "material volume {actual}, planar oracle {expected}");
    assert_eq!(connected_components(&hosts), if split { 2 } else { 1 }, "every disconnected material component must be retained");
    assert_eq!(result.stats.total_csg_failures, 0, "simple through-thickness cuts must emit closed geometry without topology failure");
}

#[test]
fn nhip_thin_axis_body_cut_keeps_rounded_hole_and_boundary_notches() { check(false); }

#[test]
fn nhip_thin_axis_body_cut_retains_both_components_after_splitting_slot() { check(true); }

// The 2026-10-24 remaining Nhip family (#298390) has tolerance-coincident
// boundary cuts. A nanometre bridge collapses during f32 storage; canonical
// hygiene must still emit a closed notch within the declared 0.2 mm Precision.
#[test]
fn nhip_thin_axis_tolerance_coincident_notch_survives_canonical_hygiene() {
    let y = -WIDTH * 0.5 + 8e-9;
    let points = [[y, 1.0], [-0.98, 1.0], [-0.96, 1.05], [-0.98, 1.25], [y, 1.25]];
    let coordinates = points.iter().map(|p| format!("({:.12},{:.12})", p[0], p[1])).collect::<Vec<_>>().join(",");
    let cut = format!(
        "#300=IFCCARTESIANPOINTLIST2D(({coordinates}));\n\
         #301=IFCINDEXEDPOLYCURVE(#300,(IFCLINEINDEX((1,2,3,4,5,1))),$);\n\
         #302=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#301);\n\
         #303=IFCEXTRUDEDAREASOLID(#302,#25,#4,0.032);\n\
         #304=IFCSHAPEREPRESENTATION(#7,'Body','SweptSolid',(#303));\n\
         #305=IFCPRODUCTDEFINITIONSHAPE($,$,(#304));\n\
         #306=IFCVOIDINGFEATURE('0000000000000000000306',$,'Cut',$,$,#17,#305,$,.HOLE.);\n\
         #307=IFCRELVOIDSELEMENT('0000000000000000000307',$,$,$,#100,#306);\n\
         ENDSEC;\nEND-ISO-10303-21;\n"
    );
    let source = fixture(false).lines().filter(|line| !line.contains("=IFCRELVOIDSELEMENT("))
        .collect::<Vec<_>>().join("\n").replace("3,1.E-7,#2", "3,0.0002,#2")
        .replace("ENDSEC;\nEND-ISO-10303-21;", &cut);
    let result = process_geometry(source.as_bytes());
    let hosts = result.meshes.iter().filter(|m| m.express_id == 100).collect::<Vec<_>>();
    assert!(!hosts.is_empty(), "the plate must survive its notch");
    let expected = THICKNESS * (WIDTH * LENGTH - polygon_area(&points));
    assert!((volume(&hosts) - expected).abs() < 4e-7, "regularization must obey the planar area bound");
    assert_eq!(result.stats.total_csg_failures, 0, "a precision-coincident through notch must not tear the host");
    let mut vertices = HashSet::new();
    let mut edges = HashMap::<([u64; 3], [u64; 3]), (usize, i64)>::new();
    let mut faces = 0_i64;
    for mesh in &hosts {
        let v = self::vertices(mesh);
        for tri in mesh.indices.as_chunks::<3>().0 {
            let q = [tri[0], tri[1], tri[2]].map(|i| v[i as usize].map(|c| if c == 0.0 { 0 } else { c.to_bits() }));
            assert!(q[0] != q[1] && q[1] != q[2] && q[2] != q[0], "no collapsed f32 face");
            vertices.extend(q);
            faces += 1;
            for i in 0..3 {
                let (a, b) = (q[i], q[(i + 1) % 3]);
                let (edge, direction) = if a < b { ((a, b), 1) } else { ((b, a), -1) };
                let reading = edges.entry(edge).or_default();
                reading.0 += 1;
                reading.1 += direction;
            }
        }
    }
    assert!(edges.values().all(|&(count, balance)| count == 2 && balance == 0), "every stored edge must have two oppositely wound faces");
    assert_eq!(vertices.len() as i64 - edges.len() as i64 + faces, 2, "a boundary notch must not leave a spurious enclosed rim");
}

fn common_plane_fixture(split: bool) -> (String, f64) {
    let outer = vec![[-1.25, -1.25], [1.25, -1.25], [1.25, 1.25], [-0.9, 1.25],
        [-0.9, 0.9], [-1.25, 0.9]];
    let circle = |cx: f64, r: f64| (0..32).map(|i| {
        let angle = f64::from(i) * std::f64::consts::TAU / 32.0;
        [cx + r * angle.cos(), r * angle.sin()]
    }).collect::<Vec<_>>();
    let existing_hole = circle(0.9, 0.1);
    let center_hole = circle(0.0, 0.4);
    let angle = (0.02_f64 / 0.06).acos();
    let start = -angle;
    let end = std::f64::consts::PI + angle;
    let mut notch = vec![[-0.02, -1.4], [0.02, -1.4]];
    for step in 0..=32 {
        let a = start + (end - start) * f64::from(step) / 32.0;
        notch.push([0.06 * a.cos(), -1.08 + 0.06 * a.sin()]);
    }
    // Independent half-plane clipping gives the removed area at each straight
    // host edge; native production uses polygon overlay, not this calculation.
    let mut clipped = Vec::new();
    for i in 0..notch.len() {
        let (a, b) = (notch[i], notch[(i + 1) % notch.len()]);
        let (inside_a, inside_b) = (a[1] >= -1.25, b[1] >= -1.25);
        if inside_a { clipped.push(a); }
        if inside_a != inside_b {
            let t = (-1.25 - a[1]) / (b[1] - a[1]);
            clipped.push([a[0] + t * (b[0] - a[0]), -1.25]);
        }
    }
    let notch_area = polygon_area(&clipped);
    let mut contours = vec![center_hole.clone()];
    for offset in [-0.6, 0.0, 0.6] {
        for side in 0..4 {
            contours.push(notch.iter().map(|p| {
                let (x, y) = (p[0] + offset, p[1]);
                match side { 0 => [x,y], 1 => [-y,x], 2 => [-x,-y], _ => [y,-x] }
            }).collect());
        }
    }
    if split { contours.push(vec![[-1.4, 0.42], [1.4, 0.42], [1.4, 0.52], [-1.4, 0.52]]); }
    let curve = |id: usize, points: &[[f64; 2]]| {
        let coordinates = points.iter().map(|p| format!("({:.12},{:.12})", p[0], p[1])).collect::<Vec<_>>().join(",");
        let indices = (1..=points.len()).map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        format!("#{id}=IFCCARTESIANPOINTLIST2D(({coordinates}));\n#{}=IFCINDEXEDPOLYCURVE(#{id},(IFCLINEINDEX(({indices},1))),$);\n", id+1)
    };
    let mut extra = curve(500, &outer) + &curve(502, &existing_hole);
    for (i, points) in contours.iter().enumerate() {
        let id = 300 + i * 8;
        extra.push_str(&curve(id, points));
        extra.push_str(&format!("#{}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#{});\n\
            #{}=IFCEXTRUDEDAREASOLID(#{},#25,#4,0.032);\n\
            #{}=IFCSHAPEREPRESENTATION(#7,'Body','SweptSolid',(#{}));\n\
            #{}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{}));\n\
            #{}=IFCVOIDINGFEATURE('000000000000000000{:04}',$,'Cut',$,$,#17,#{},$,.HOLE.);\n\
            #{}=IFCRELVOIDSELEMENT('000000000000000000{:04}',$,$,$,#100,#{});\n",
            id+2,id+1,id+3,id+2,id+4,id+3,id+5,id+4,id+6,id+6,id+5,id+7,id+7,id+6));
    }
    extra.push_str("ENDSEC;\nEND-ISO-10303-21;");
    let source = fixture(false).lines().filter(|line| !line.contains("=IFCRELVOIDSELEMENT("))
        .collect::<Vec<_>>().join("\n")
        .replace("#18=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,0.016,2.46);", "#18=IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,#501,(#503));")
        .replace("#19=IFCEXTRUDEDAREASOLID(#18,#2,#4,3.114);", "#19=IFCEXTRUDEDAREASOLID(#18,#2,#4,0.016);")
        .replace("#22=IFCCARTESIANPOINT((-0.016,0.,0.));", "#22=IFCCARTESIANPOINT((0.,0.,-0.008));")
        .replace("#25=IFCAXIS2PLACEMENT3D(#22,#23,#24);", "#25=IFCAXIS2PLACEMENT3D(#22,#4,#23);")
        .replace("ENDSEC;\nEND-ISO-10303-21;", &extra);
    // The optional 100 mm slot spans the 2.5 m host without overlap.
    let area = polygon_area(&outer) - polygon_area(&existing_hole) - polygon_area(&center_hole)
        - 12.0 * notch_area - if split { 0.25 } else { 0.0 };
    (source, THICKNESS * area)
}

fn check_common_plane(split: bool) {
    let (source, expected) = common_plane_fixture(split);
    let result = process_geometry(source.as_bytes());
    let hosts = result.meshes.iter().filter(|m| m.express_id == 100).collect::<Vec<_>>();
    assert!(!hosts.is_empty());
    assert!((volume(&hosts) - expected).abs() < 2e-6, "concave host material volume {}, oracle {expected}", volume(&hosts));
    assert_eq!(result.stats.total_csg_failures, 0, "all-through edge notches must not enter a failing residual cut");
    assert_eq!(connected_components(&hosts), if split { 2 } else { 1 });
}

// Remaining Nhip family #150461/#152785: nonrectangular single extrusion,
// an existing hole, a new hole, and a through-cut crossing its boundary.
#[test]
fn nhip_common_plane_concave_host_preserves_existing_holes_and_edge_notches() { check_common_plane(false); }

#[test]
fn nhip_common_plane_concave_host_keeps_all_split_components() { check_common_plane(true); }
