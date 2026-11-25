// SPDX-License-Identifier: MPL-2.0
use super::*;
use crate::native::Jobs;
use ifc_lite_export::colorizer::ColorizerBatch;

fn upload(jobs: &Jobs) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/viewer/public/samples/building-architecture.ifc");
    let bytes = std::fs::read(path).unwrap();
    let id = jobs.create().unwrap();
    for chunk in bytes.chunks(INPUT_CHUNK_BYTES) { jobs.append(&id,chunk).unwrap(); }
    id
}

#[test]
fn colorizer_native_export_streams_a_full_model_and_existing_edits() {
    let jobs = Jobs::default();
    let id = upload(&jobs);
    let job = jobs.get(&id).unwrap();
    prepare(&job,r#"{"mutations":[]}"#).unwrap();
    let discovered = catalog(&job,&ColorizerGrouping::default()).unwrap();
    assert!(!discovered.product_ids.is_empty());
    let product = discovered.product_ids[0];
    let edits = serde_json::json!({"mutations":[{"type":"UPDATE_ATTRIBUTE","entityId":product,
        "attributeName":"Name","newValue":"Existing edit retained"}]});
    prepare(&job,&edits.to_string()).unwrap();
    let bytes = export(&job,&ColorizerRequest { batches:vec![ColorizerBatch { products:vec![product],color:[1.,0.,0.,1.] }] }).unwrap();
    let mut result = Vec::new();
    loop {
        let chunk = next_packet(&job).unwrap();
        assert!(chunk.len() <= INPUT_CHUNK_BYTES);
        if chunk.is_empty() { break; }
        result.extend(chunk);
    }
    assert_eq!(result.len() as u64,bytes);
    let text = String::from_utf8(result).unwrap();
    assert!(text.contains("Existing edit retained"));
    assert!(text.contains("IFCPROJECT"));
    assert!(text.contains("IFCSURFACESTYLERENDERING"));
    jobs.close(&id).unwrap();
    assert!(catalog(&job,&ColorizerGrouping::default()).is_err());
}

#[test]
fn colorizer_native_refuses_invalid_edit_logs_and_closed_sessions() {
    let jobs = Jobs::default();
    let id = upload(&jobs);
    let job = jobs.get(&id).unwrap();
    assert!(prepare(&job,"not-json").is_err());
    assert!(catalog(&job,&ColorizerGrouping::default()).is_err());
    jobs.close(&id).unwrap();
    assert!(prepare(&job,r#"{"mutations":[]}"#).is_err());
}

#[test]
fn core_10_4_colorizer_refuses_a_duplicate_record_without_a_download() {
    // Upstream #7682 now reports dropped duplicate records. The native host
    // must keep treating that loss warning as an export refusal.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/viewer/public/samples/building-architecture.ifc");
    let mut bytes = std::fs::read(path).unwrap();
    let (_, _, start, end) = ifc_lite_core::EntityScanner::new(&bytes).next_entity().unwrap();
    let duplicate = bytes[start..end].to_vec();
    bytes.splice(end..end, duplicate);
    let jobs = Jobs::default();
    let id = jobs.create().unwrap();
    for chunk in bytes.chunks(INPUT_CHUNK_BYTES) { jobs.append(&id, chunk).unwrap(); }
    let job = jobs.get(&id).unwrap();
    prepare(&job, r#"{"mutations":[]}"#).unwrap();
    let result = export(&job, &ColorizerRequest { batches: Vec::new() });
    let error = result.expect_err("A partial source must not become a successful download");
    assert!(error.to_lowercase().contains("duplicate"), "{error}");
    assert!(next_packet(&job).is_err());
    jobs.close(&id).unwrap();
}
