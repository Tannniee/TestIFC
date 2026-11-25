use super::*;

#[test]
fn semantic_packets_are_bounded_and_reconstruct_all_rows_without_loss() {
    let cancel = AtomicBool::new(false);
    let rows = [serde_json::json!({"entity_id":1,"name":"Mô hình 🌏"}), serde_json::json!({"entity_id":2})];
    let mut stream = SemanticStream::encode(|writer| {
        for row in &rows { record(writer, "entities", row, &cancel)?; }
        record(writer, "complete", &true, &cancel)
    }).unwrap();
    let path = stream.0.path().to_owned();
    let expected = stream.byte_len().unwrap();
    let mut joined = Vec::new();
    loop {
        let chunk = stream.next_packet(31).unwrap();
        assert!(chunk.len() <= 31);
        if chunk.is_empty() { break; }
        joined.extend(chunk);
    }
    assert_eq!(joined.len() as u64, expected);
    let records: Vec<(String, serde_json::Value)> = String::from_utf8(joined).unwrap()
        .lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    let actual: Vec<_> = records.iter().filter(|(table, _)| table == "entities").map(|(_, row)| row).collect();
    assert_eq!(serde_json::to_value(actual).unwrap(), serde_json::to_value(rows).unwrap());
    assert_eq!(records.last().unwrap(), &("complete".into(), serde_json::json!(true)));
    drop(stream);
    assert!(!path.exists());
}

#[test]
fn cancelled_semantic_encoding_does_not_publish_a_partial_stream() {
    assert!(SemanticStream::encode(|writer| record(writer, "complete", &true, &AtomicBool::new(true))).is_err());
}
