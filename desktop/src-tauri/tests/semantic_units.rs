// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#[path = "../../../apps/server/src/services/data_model/project_units.rs"]
mod types;

use ifc_lite_core::{build_entity_index, EntityDecoder, project_units::ProjectUnits};
use ifc_lite_desktop::semantic::{record, SemanticStream};
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;

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
    let mut decoder = EntityDecoder::with_index(source, build_entity_index(source));
    let cancel = AtomicBool::new(false);
    let mut stream = SemanticStream::encode(|writer| {
        for id in [1, 2] {
            let assignment = types::ProjectUnitAssignment::from(ProjectUnits::resolve(&mut decoder, id));
            record(writer, "projectUnits", &(id, assignment), &cancel)?;
        }
        record(writer, "complete", &true, &cancel)
    }).unwrap();
    let total = stream.byte_len().unwrap();
    let mut bytes = Vec::new();
    loop {
        let packet = stream.next_packet(7).unwrap();
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
