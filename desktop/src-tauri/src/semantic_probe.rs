// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Headless diagnostic for the actual desktop semantic preparation path.
//! Kept outside cfg(test), which would enable HTTP/Arrow-only server tests.
#[cfg(not(test))]
pub mod services;
#[cfg(not(test))]
mod semantic_model;

#[cfg(not(test))]
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(not(test))]
fn run() -> Result<(), String> {
    use ifc_lite_desktop::native::Jobs;
    use serde_json::json;
    use std::{path::Path, sync::mpsc, time::{Duration, Instant}};

    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).ok_or("Expected IFC snapshot path")?;
    let mode = args.get(2).map(String::as_str).unwrap_or("none");
    let delay_ms: u64 = args.get(3).map(|value| value.parse())
        .transpose().map_err(|error| format!("Invalid delay: {error}"))?.unwrap_or(100);
    let jobs = Jobs::default();
    let id = jobs.import_path(Path::new(path))?;
    let job = jobs.get(&id)?;
    if mode == "parity" {
        use services::data_model::{extract_data_model, extract_data_model_scoped, DataModelEntities};
        let source = job.semantic_source()?;
        let mut all = extract_data_model(&source);
        DataModelEntities::Rooted.apply(&mut all);
        let rooted = extract_data_model_scoped(&source, DataModelEntities::Rooted);
        let snapshot = |model: &services::data_model::DataModel| json!({
            "units": model.project_units, "entities": model.entities, "psets": model.property_sets,
            "qsets": model.quantity_sets, "relationships": model.relationships,
            "classifications": model.classifications, "materials": model.materials,
            "documents": model.documents, "spatial": model.spatial_hierarchy,
        });
        println!("{}", json!({"parity": snapshot(&all) == snapshot(&rooted),
            "entityIds": rooted.entities.iter().map(|e| e.entity_id).collect::<Vec<_>>() }));
        jobs.close(&id)?;
        return Ok(());
    }
    if mode == "before" { jobs.close(&id)?; }

    let (started_tx, started_rx) = mpsc::channel();
    let worker_job = job.clone();
    let start = Instant::now();
    let worker = std::thread::spawn(move || {
        started_tx.send(()).expect("Probe receiver remains alive");
        semantic_model::prepare(&worker_job, true)
    });
    started_rx.recv().map_err(|error| error.to_string())?;
    let cancellation_start = if mode == "during" {
        // Timing is intentionally reported: this proves the real external
        // close-to-exit latency, rather than a test-only extraction hook.
        std::thread::sleep(Duration::from_millis(delay_ms));
        let at = Instant::now();
        jobs.close(&id)?;
        Some(at)
    } else { None };
    let result = worker.join().map_err(|_| "Semantic worker panicked")?;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let cancel_latency_ms = cancellation_start.map(|at| at.elapsed().as_secs_f64() * 1000.0);
    let mut records = Vec::<serde_json::Value>::new();
    let published = if result.is_ok() {
        let mut bytes = Vec::new();
        loop {
            let packet = job.next_semantic_packet()?;
            if packet.is_empty() { break; }
            bytes.extend(packet);
        }
        for line in std::str::from_utf8(&bytes).map_err(|error| error.to_string())?.lines() {
            records.push(serde_json::from_str(line).map_err(|error| error.to_string())?);
        }
        true
    } else { job.next_semantic_packet().is_ok() };
    println!("{}", json!({
        "elapsedMs": elapsed_ms, "cancelLatencyMs": cancel_latency_ms,
        "resultBytes": result.as_ref().ok(), "error": result.err(),
        "published": published, "records": records,
    }));
    jobs.close(&id)?;
    Ok(())
}
