// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#[path = "../src/semantic_model.rs"]
mod semantic_model;

use ifc_lite_desktop::native::Jobs;
use serde_json::{json, Value};

#[test]
fn canonical_units_and_native_records_preserve_complete_per_project_assignments() {
    let source = br#"ISO-10303-21;
HEADER; FILE_SCHEMA(('IFC4')); ENDSEC;
DATA;
#1=IFCPROJECT('project-mm',$,'Project mm',$,$,$,$,$,#10);
#2=IFCPROJECT('project-m',$,'Project m',$,$,$,$,$,#20);
#10=IFCUNITASSIGNMENT((#11,#12,#13,#14));
#11=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#12=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#13=IFCMONETARYUNIT('USD');
#14=IFCCONVERSIONBASEDUNIT($,.MASSUNIT.,'Unresolved mass',#999);
#20=IFCUNITASSIGNMENT((#21,#22));
#21=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#22=IFCSIUNIT(*,.AREAUNIT.,.MILLI.,.SQUARE_METRE.);
ENDSEC; END-ISO-10303-21;"#;
    let jobs = Jobs::default();
    let id = jobs.create().unwrap();
    jobs.append(&id, source).unwrap();
    let job = jobs.get(&id).unwrap();
    let total = semantic_model::prepare(&job, true).unwrap();
    let mut bytes = Vec::new();
    loop {
        let packet = job.next_semantic_packet().unwrap();
        if packet.is_empty() { break; }
        bytes.extend(packet);
    }
    assert_eq!(bytes.len() as u64, total);
    let records: Vec<Value> = std::str::from_utf8(&bytes).unwrap().lines()
        .map(|line| serde_json::from_str(line).unwrap()).collect();
    let units: Vec<&Value> = records.iter().filter(|row| row[0] == "projectUnits")
        .map(|row| &row[1]).collect();
    assert_eq!(units.len(), 2);
    assert_eq!(units[0][0], 1);
    assert_eq!(units[0][1]["byType"]["LENGTHUNIT"], json!({"symbol":"mm","siScale":0.001}));
    assert_eq!(units[0][1]["byType"]["AREAUNIT"], json!({"symbol":"m²","siScale":1.0}));
    assert!(units[0][1]["byType"].as_object().unwrap().contains_key("MASSUNIT"));
    assert_eq!(units[0][1]["byType"]["MASSUNIT"], Value::Null);
    assert_eq!(units[0][1]["monetary"], json!({"symbol":"$","siScale":1.0}));
    assert_eq!(units[1][1]["byType"]["AREAUNIT"], json!({"symbol":"mm²","siScale":0.000001}));
    assert_eq!(records.last().unwrap(), &json!(["complete",true]));
}

#[test]
fn refused_material_expansion_never_publishes_native_semantics_7675() {
    let layers = vec!["#3"; 1_000].join(",");
    let elements = (100..1_100).map(|id| format!("#{id}")).collect::<Vec<_>>().join(",");
    let source = format!("ISO-10303-21;\nHEADER; FILE_SCHEMA(('IFC4')); ENDSEC;\nDATA;\n\
        #2=IFCMATERIAL('Concrete',$,$);\n\
        #3=IFCMATERIALLAYER(#2,0.1,$,'Core',$,$,$);\n\
        #4=IFCMATERIALLAYERSET(({layers}),'Wall',$);\n\
        #5=IFCRELASSOCIATESMATERIAL('Rel0000000000000007675',$,$,$,({elements}),#4);\n\
        ENDSEC; END-ISO-10303-21;\n");
    let jobs = Jobs::default();
    let id = jobs.create().unwrap();
    jobs.append(&id, source.as_bytes()).unwrap();
    let job = jobs.get(&id).unwrap();
    let error = semantic_model::prepare(&job, true).unwrap_err();
    assert!(error.contains("material associations exceed"), "{error}");
    assert!(job.next_semantic_packet().unwrap_err().contains("not ready"),
        "a refused extraction must never publish a completion record or partial stream");
}
