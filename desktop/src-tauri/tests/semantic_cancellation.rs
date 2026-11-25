// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use serde_json::{json, Value};
use std::{io::{BufWriter, Write}, process::Command};

fn fixture(groups: usize) -> tempfile::NamedTempFile {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    {
        let mut writer = BufWriter::new(file.as_file_mut());
        writeln!(writer, "ISO-10303-21;\nHEADER; FILE_SCHEMA(('IFC4')); ENDSEC;\nDATA;").unwrap();
        writeln!(writer, "#1=IFCPROJECT('project',$,'Cancellation fixture',$,$,$,$,$,#2);").unwrap();
        writeln!(writer, "#2=IFCUNITASSIGNMENT((#3));\n#3=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);").unwrap();
        for i in 0..groups {
            let id = 10 + i * 4;
            writeln!(writer, "#{id}=IFCWALL('wall-{i}',$,'Wall {i}',$,$,$,$,$,.NOTDEFINED.);").unwrap();
            writeln!(writer, "#{}=IFCPROPERTYSINGLEVALUE('Diameter',$,IFCLENGTHMEASURE(20.),$);", id + 1).unwrap();
            writeln!(writer, "#{}=IFCPROPERTYSET('pset-{i}',$,'Dimensions',$,(#{}));", id + 2, id + 1).unwrap();
            writeln!(writer, "#{}=IFCRELDEFINESBYPROPERTIES('rel-{i}',$,$,$,(#{id}),#{});", id + 3, id + 2).unwrap();
        }
        writeln!(writer, "ENDSEC; END-ISO-10303-21;").unwrap();
        writer.flush().unwrap();
    }
    file
}

fn probe(file: &tempfile::NamedTempFile, mode: &str) -> Value {
    probe_at(file, mode, 100)
}

fn probe_at(file: &tempfile::NamedTempFile, mode: &str, delay: u64) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_native-semantic-probe"))
        .arg(file.path()).arg(mode).arg(delay.to_string())
        .env("RAYON_NUM_THREADS", "2").output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    eprintln!("semantic {mode}: {}", json!({
        "elapsedMs": report["elapsedMs"], "cancelLatencyMs": report["cancelLatencyMs"],
        "error": report["error"], "published": report["published"],
    }));
    report
}

#[test]
fn cancelling_before_semantic_work_publishes_no_stream() {
    let report = probe(&fixture(2), "before");
    assert!(report["error"].as_str().unwrap().contains("cancelled"));
    assert_eq!(report["published"], false);
    assert!(report["elapsedMs"].as_f64().unwrap() < 500.0);
}

#[test]
fn cancelling_during_semantic_extraction_stops_within_half_a_second() {
    // 1.6m distinct IFC rows: well beyond the 100 ms close delay, even in
    // optimized builds. This is an external elapsed-time regression gate,
    // not an assertion about the implementation's polling frequency.
    let file = fixture(400_000);
    for delay in [100, 400, 800] {
        let report = probe_at(&file, "during", delay);
        assert!(report["error"].as_str().unwrap().contains("cancelled"));
        assert_eq!(report["published"], false);
        assert!(report["cancelLatencyMs"].as_f64().unwrap() < 500.0,
            "closed native job kept extracting semantics at {delay} ms: {report}");
    }
}

#[test]
fn indexed_rooted_endpoints_preserve_the_canonical_complete_model() {
    let file = fixture(3);
    // A non-rooted endpoint must be recovered by its indexed raw record,
    // retaining source order and unknown class spelling without a full scan.
    let source = std::fs::read_to_string(file.path()).unwrap().replace(
        "ENDSEC; END-ISO-10303-21;",
        "#500=IFCMATERIAL('Steel',$,$);\n#501=IFCRELASSOCIATESMATERIAL('material-rel',$,$,$,(#10),#500);\nENDSEC; END-ISO-10303-21;",
    );
    std::fs::write(file.path(), source).unwrap();
    let report = probe(&file, "parity");
    assert_eq!(report["parity"], true);
    assert!(report["entityIds"].as_array().unwrap().contains(&json!(500)));
}

#[test]
fn uninterrupted_native_preparation_preserves_property_relationship_and_units() {
    let report = probe(&fixture(2), "none");
    assert_eq!(report["error"], Value::Null);
    assert_eq!(report["published"], true);
    let records = report["records"].as_array().unwrap();
    assert_eq!(records.last().unwrap(), &json!(["complete", true]));
    let psets: Vec<&Value> = records.iter().filter(|row| row[0] == "propertySets").collect();
    assert_eq!(psets.len(), 2);
    assert_eq!(psets[0][1]["properties"][0]["property_name"], "Diameter");
    assert_eq!(psets[0][1]["properties"][0]["property_value"], "20");
    assert_eq!(psets[0][1]["properties"][0]["data_type"], "IFCLENGTHMEASURE");
    let relationships: Vec<&Value> = records.iter().filter(|row| row[0] == "relationships").collect();
    assert_eq!(relationships.len(), 2);
    assert_eq!(relationships[0][1]["related_id"], 10);
    assert_eq!(relationships[0][1]["relating_id"], 12);
    let units = records.iter().find(|row| row[0] == "projectUnits").unwrap();
    assert_eq!(units[1][0], 1);
    assert_eq!(units[1][1]["byType"]["LENGTHUNIT"], json!({"symbol": "mm", "siScale": 0.001}));
}
