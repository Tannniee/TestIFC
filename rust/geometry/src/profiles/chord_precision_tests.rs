// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Nhip 2026-10-26: finite manufacturing cutters need a physical chord bound,
//! while ordinary profile density remains the existing compatibility contract.
use super::*;

fn source(metres_per_unit: f64) -> String {
    let r = 0.2 / metres_per_unit;
    let prefix = if metres_per_unit == 0.001 { ".MILLI." } else { "$" };
    // (0.6r,0.8r) lies exactly on the circle, away from the 45-degree
    // rounding boundary in the ordinary sampler's segment-count estimate.
    format!("#1=IFCCARTESIANPOINTLIST2D((({r},0.),({},{}),(0.,{r}),(0.,0.)));\n\
        #2=IFCINDEXEDPOLYCURVE(#1,(IFCARCINDEX((1,2,3)),IFCLINEINDEX((3,4,1))),$);\n\
        #3=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#2);\n\
        #4=IFCCIRCLEPROFILEDEF(.AREA.,$,$,{circle_radius});\n\
        #5=IFCCARTESIANPOINT((0.,0.));\n\
        #6=IFCAXIS2PLACEMENT2D(#5,$);\n\
        #7=IFCCIRCLE(#6,{circle_radius});\n\
        #8=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#7);\n\
        #10=IFCSIUNIT(*,.LENGTHUNIT.,{prefix},.METRE.);\n\
        #11=IFCUNITASSIGNMENT((#10));\n\
        #12=IFCPROJECT('0000000000000000000001',$,$,$,$,$,$,$,#11);\n",
        r * 0.6, r * 0.8, circle_radius = 0.035 / metres_per_unit)
}

fn process(content: &str, id: u32, tolerance: Option<f64>) -> Result<Profile2D> {
    let mut decoder = EntityDecoder::new(content);
    let entity = decoder.decode_by_id(id).expect("synthetic IFC profile");
    let processor = match tolerance {
        Some(tolerance) => ProfileProcessor::with_chord_tolerance(IfcSchema::new(), tolerance),
        None => ProfileProcessor::new(IfcSchema::new()),
    };
    processor.process(&entity, &mut decoder, TessellationQuality::Medium)
}

fn maximum_chord_deviation(profile: &Profile2D, radius: f64) -> f64 {
    let points = &profile.outer;
    let mut maximum = 0.0_f64;
    let mut circular_segments = 0;
    for (a, b) in points.iter().zip(points.iter().cycle().skip(1)).take(points.len()) {
        // The sector's two radial straight edges are not circular chords.
        if a.coords.norm() < radius * 0.5 || b.coords.norm() < radius * 0.5 { continue; }
        assert!((a.coords.norm() - radius).abs() < radius * 1e-10, "circular vertex {a:?} left its authored radius {radius}");
        assert!((b.coords.norm() - radius).abs() < radius * 1e-10, "circular vertex {b:?} left its authored radius {radius}");
        maximum = maximum.max(radius - ((a.coords + b.coords) * 0.5).norm());
        circular_segments += 1;
    }
    assert!(circular_segments > 0, "the processed profile must contain its circular boundary");
    maximum
}

#[test]
fn finite_profile_chords_obey_50_micrometres_in_metre_and_millimetre_files() {
    for metres_per_unit in [1.0, 0.001] {
        let content = source(metres_per_unit);
        let tolerance = 50e-6 / metres_per_unit;
        for (id, radius_metres) in [(3, 0.2), (4, 0.035), (8, 0.035)] {
            let profile = process(&content, id, Some(tolerance)).expect("bounded circular profile");
            let deviation = maximum_chord_deviation(&profile, radius_metres / metres_per_unit);
            assert!(deviation <= tolerance * (1.0 + 1e-9), "profile #{id}: deviation {deviation} exceeds file-unit bound {tolerance}");
            assert!(deviation * metres_per_unit <= 50e-6 * (1.0 + 1e-9));
        }
    }
}

#[test]
fn ordinary_profile_counts_keep_the_existing_density_without_a_chord_override() {
    let content = source(0.001);
    let arc = process(&content, 3, None).expect("ordinary arc");
    let circle = process(&content, 4, None).expect("ordinary circle");
    assert_eq!(arc.outer.len(), 13, "ordinary quarter arc plus radial closure keeps its historical points");
    assert_eq!(circle.outer.len(), 36, "ordinary circle remains the 36-segment profile");
    assert!(maximum_chord_deviation(&arc, 200.0) > 0.05, "only the explicit manufacturing override promises 50 um");
}

#[test]
fn an_unachievable_profile_chord_bound_reports_error_instead_of_truncating() {
    let content = source(0.001);
    for id in [3, 4, 8] {
        assert!(process(&content, id, Some(1e-9)).is_err(), "profile #{id} must report its segment-budget limit");
    }
}

#[test]
fn many_fine_arcs_report_the_shared_sample_budget_instead_of_emitting_a_prefix() {
    let mut content=source(0.001);
    let segments=vec!["#20";5000].join(",");
    content.push_str(&format!("#20=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#2);\n#21=IFCCOMPOSITECURVE(({segments}),.F.);\n#22=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#21);\n"));
    assert!(process(&content,22,None).is_ok(),"this is below the ordinary traversal budget");
    let error=process(&content,22,Some(0.05)).expect_err("fine sampling must bound aggregate work");
    assert!(error.to_string().contains("budget"),"exhaustion must be reported: {error}");
}
