// SPDX-License-Identifier: MPL-2.0
//! Source-only editing sessions. Geometry loading never retains these buffers.
use crate::native::{Job, INPUT_CHUNK_BYTES};
use ifc_lite_export::{colorizer::{catalog_colorizer, plan_colorizer, ColorizerCatalog, ColorizerGrouping, ColorizerRequest},
    export_step_with_log_to_writer, MutationLog, StepOptions};
use std::{io::{Read, Seek, SeekFrom, Write}, sync::atomic::Ordering};
use tempfile::NamedTempFile;

pub(crate) struct Document { effective: NamedTempFile, output: Option<NamedTempFile> }

fn check(job: &Job) -> Result<(), String> {
    if job.cancellation().load(Ordering::Acquire) { Err("Colorizer was cancelled".into()) } else { Ok(()) }
}

pub fn prepare(job: &Job, mutations: &str) -> Result<(), String> {
    check(job)?;
    let bytes = job.semantic_source()?;
    let log = MutationLog::from_json(mutations).map_err(|e| format!("Invalid editing snapshot: {e}"))?;
    let mut effective = NamedTempFile::new().map_err(|e| e.to_string())?;
    if log.is_empty() { effective.write_all(&bytes).map_err(|e| e.to_string())?; }
    else {
        let stats = export_step_with_log_to_writer(&bytes, &StepOptions::default(), &log, &mut effective).map_err(|e| e.to_string())?;
        if !stats.warnings.is_empty() { return Err(format!("Existing edits could not be exported: {}",stats.warnings.join("; "))); }
    }
    check(job)?;
    let mut guard = job.colorizer.lock().map_err(|_| "Colorizer session lock was poisoned")?;
    check(job)?;
    *guard = Some(Document { effective, output: None });
    Ok(())
}

pub fn catalog(job: &Job, grouping: &ColorizerGrouping) -> Result<ColorizerCatalog,String> {
    check(job)?;
    let guard = job.colorizer.lock().map_err(|_| "Colorizer session lock was poisoned")?;
    let document = guard.as_ref().ok_or("Prepare the Colorizer source first")?;
    let bytes = std::fs::read(document.effective.path()).map_err(|e| e.to_string())?;
    let result = catalog_colorizer(&bytes,grouping)?;
    check(job)?;
    Ok(result)
}

pub fn export(job: &Job, request: &ColorizerRequest) -> Result<u64,String> {
    check(job)?;
    let mut guard = job.colorizer.lock().map_err(|_| "Colorizer session lock was poisoned")?;
    let document = guard.as_mut().ok_or("Prepare the Colorizer source first")?;
    // Discard any old download before starting a new one; a failed export may
    // never be mistaken for the previous successful result.
    document.output = None;
    let bytes = std::fs::read(document.effective.path()).map_err(|e| e.to_string())?;
    let log = plan_colorizer(&bytes,request)?;
    check(job)?;
    let mut output = NamedTempFile::new().map_err(|e| e.to_string())?;
    let stats = export_step_with_log_to_writer(&bytes,&StepOptions::default(),&log,&mut output).map_err(|e| e.to_string())?;
    if !stats.warnings.is_empty() { return Err(format!("Colour export refused: {}",stats.warnings.join("; "))); }
    check(job)?;
    let length = output.as_file().metadata().map_err(|e| e.to_string())?.len();
    output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    document.output = Some(output);
    Ok(length)
}

pub fn next_packet(job: &Job) -> Result<Vec<u8>,String> {
    check(job)?;
    let mut guard = job.colorizer.lock().map_err(|_| "Colorizer session lock was poisoned")?;
    let document = guard.as_mut().ok_or("The Colorizer session is closed")?;
    let output = document.output.as_mut().ok_or("No completed Colorizer export")?;
    let mut packet = vec![0;INPUT_CHUNK_BYTES];
    let length = output.read(&mut packet).map_err(|e| e.to_string())?;
    packet.truncate(length);
    if length == 0 { document.output = None; }
    Ok(packet)
}

#[cfg(test)]
#[path = "colorizer_tests.rs"]
mod tests;
