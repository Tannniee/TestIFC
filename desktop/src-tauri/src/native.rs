// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Job-scoped native IFC processing. Two queued packets, cooperative cancel,
//! raw chunk ingress and deterministic temporary-source cleanup.
use ifc_lite_processing::{process_geometry_streaming_filtered_with_baked_basis, OpeningFilterMode, ModelMetadata, ProcessingStats, StreamingOptions};
use serde::Serialize;
use std::{collections::HashMap, fs::File, io::{Read, Write}, path::Path,
    sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}, mpsc::{self, Receiver, TrySendError}}, time::Duration};
use tempfile::NamedTempFile;
use crate::partition;

pub const INPUT_CHUNK_BYTES: usize = 2 * 1024 * 1024;
pub const QUEUED_PACKETS: usize = 2;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub metadata: ModelMetadata,
    pub stats: ProcessingStats,
    pub mesh_coordinate_space: ifc_lite_processing::MeshCoordinateSpace,
    pub site_transform: Option<Vec<f64>>,
    pub building_transform: Option<Vec<f64>>,
    pub building_rotation: Option<f64>,
    pub color_updates: Vec<(u32, [f32; 4])>,
    pub viewer_bounds: [f64; 6],
    pub flat_meshes: usize,
    pub instanced_occurrences: usize,
    pub instanced_templates: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub done: bool,
    pub error: Option<String>,
    pub summary: Option<Summary>,
    pub progress: GeometryProgress,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryProgress {
    pub processed_elements: usize,
    pub total_elements: usize,
    pub meshes: usize,
}

pub struct Job {
    pub(crate) colorizer: Mutex<Option<crate::colorizer::Document>>,
    source: Mutex<NamedTempFile>,
    cancel: Arc<AtomicBool>,
    started: AtomicBool,
    receiver: Mutex<Option<Receiver<Vec<u8>>>>,
    outcome: Mutex<Option<Result<Summary, String>>>,
    progress: Mutex<GeometryProgress>,
    semantics: Mutex<Option<crate::semantic::SemanticStream>>,
}

#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, Arc<Job>>>);

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    mutex.lock().map_err(|_| "Native job lock was poisoned".to_string())
}

impl Jobs {
    pub fn create(&self) -> Result<String, String> {
        if usize::BITS != 64 { return Err("Native IFC requires a 64-bit host".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        let source = NamedTempFile::new().map_err(|e| e.to_string())?;
        let job = Arc::new(Job { colorizer: Mutex::new(None), source: Mutex::new(source), cancel: Arc::new(AtomicBool::new(false)),
            started: AtomicBool::new(false), receiver: Mutex::new(None), outcome: Mutex::new(None),
            progress: Mutex::new(GeometryProgress::default()), semantics: Mutex::new(None) });
        lock(&self.0)?.insert(id.clone(), job);
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Result<Arc<Job>, String> {
        lock(&self.0)?.get(id).cloned().ok_or_else(|| "Native job is closed or unknown".into())
    }

    pub fn append(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.is_empty() || bytes.len() > INPUT_CHUNK_BYTES { return Err("Invalid native source chunk size".into()); }
        let job = self.get(id)?;
        let mut source = lock(&job.source)?;
        if job.started.load(Ordering::Acquire) { return Err("Native job has already started".into()); }
        source.write_all(bytes).map_err(|e| e.to_string())
    }

    /// Read a disk file in bounded chunks. The snapshot isolates processing from
    /// later external edits; it never materializes a source buffer in WebView2.
    pub fn import_path(&self, path: &Path) -> Result<String, String> {
        let mut input = File::open(path).map_err(|e| e.to_string())?;
        let id = self.create()?;
        let result = (|| {
            let mut bytes = vec![0; INPUT_CHUNK_BYTES];
            loop {
                let count = input.read(&mut bytes).map_err(|e| e.to_string())?;
                if count == 0 { break; }
                self.append(&id, &bytes[..count])?;
            }
            Ok(())
        })();
        if let Err(error) = result { self.close(&id)?; return Err(error); }
        Ok(id)
    }

    pub fn start(&self, id: &str) -> Result<(), String> {
        let job = self.get(id)?;
        // Same lock as append: no append can pass its guard after processing starts.
        let source = lock(&job.source)?;
        if job.started.swap(true, Ordering::AcqRel) { return Err("Native job has already started".into()); }
        let path = source.path().to_owned();
        drop(source);
        let (sender, receiver) = mpsc::sync_channel(QUEUED_PACKETS);
        *lock(&job.receiver)? = Some(receiver);
        std::thread::spawn(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let content = std::fs::read(path).map_err(|e| e.to_string())?;
                if !content.starts_with(b"ISO-10303-21;") && !content.windows(13).take(1024).any(|w| w == b"ISO-10303-21;") {
                    return Err("Native geometry requires a STEP IFC source".into());
                }
                let mut failure = None;
                let mut colors = Vec::new();
                let mut bounds = [f64::INFINITY, f64::INFINITY, f64::INFINITY,
                    f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
                let basis = OnceLock::new();
                let (mut flat_meshes, mut instanced_occurrences, mut instanced_templates) = (0, 0, 0);
                let result = process_geometry_streaming_filtered_with_baked_basis(&content, OpeningFilterMode::Default, StreamingOptions {
                    initial_batch_size: 16, throughput_batch_size: 65536,
                    retain_emitted_meshes: false, cancel: Some(job.cancel.clone()),
                    ..StreamingOptions::default()
                }, &basis, |meshes, processed, total| {
                    if failure.is_some() || job.cancel.load(Ordering::Acquire) { return; }
                    match job.progress.lock() {
                        Ok(mut progress) => {
                            progress.processed_elements = processed;
                            progress.total_elements = total;
                            progress.meshes += meshes.len();
                        },
                        Err(error) => { failure = Some(error.to_string()); job.cancel.store(true, Ordering::Release); return; }
                    }
                    match partition::encode(meshes, basis.get().expect("Canonical basis precedes batches"), &mut bounds) {
                        Ok(part) => {
                          flat_meshes += part.flat_meshes;
                          instanced_occurrences += part.occurrences;
                          instanced_templates += part.templates;
                          for mut packet in part.packets { loop {
                            if job.cancel.load(Ordering::Acquire) { break; }
                            match sender.try_send(packet) {
                                Ok(()) => break,
                                Err(TrySendError::Full(value)) => { packet = value; std::thread::sleep(Duration::from_millis(5)); }
                                Err(TrySendError::Disconnected(_)) => { job.cancel.store(true, Ordering::Release); break; }
                            }
                          } }
                        },
                        Err(error) => { failure = Some(error); job.cancel.store(true, Ordering::Release); }
                    }
                }, |updates| colors.extend_from_slice(updates), |_| {});
                if let Some(error) = failure { return Err(error); }
                if job.cancel.load(Ordering::Acquire) { return Err("Native IFC job cancelled".into()); }
                let building_rotation = result.site_transform.as_deref()
                    .and_then(|matrix| <&[f64; 16]>::try_from(matrix).ok())
                    .and_then(ifc_lite_geometry::rotation_angle_about_z);
                Ok(Summary { metadata: result.metadata, stats: result.stats, building_rotation,
                    mesh_coordinate_space: if result.frame.needs_shift() { ifc_lite_processing::MeshCoordinateSpace::ModelRtc }
                        else { ifc_lite_processing::MeshCoordinateSpace::RawIfc }, site_transform: result.site_transform,
                    building_transform: result.building_transform, color_updates: colors, viewer_bounds: bounds,
                    flat_meshes, instanced_occurrences, instanced_templates })
            })).unwrap_or_else(|_| Err("Native IFC worker panicked".into()));
            match job.outcome.lock() {
                Ok(mut value) => *value = Some(outcome),
                Err(error) => tracing::error!(%error, "Cannot record native IFC outcome"),
            }
        });
        Ok(())
    }

    pub fn next_packet(&self, id: &str) -> Result<Vec<u8>, String> {
        let job = self.get(id)?;
        let guard = lock(&job.receiver)?;
        let receiver = guard.as_ref().ok_or("Native job has not started")?;
        match receiver.try_recv() {
            Ok(bytes) => Ok(bytes),
            Err(mpsc::TryRecvError::Empty | mpsc::TryRecvError::Disconnected) => Ok(Vec::new()),
        }
    }

    pub fn status(&self, id: &str) -> Result<Status, String> {
        let job = self.get(id)?;
        let outcome = lock(&job.outcome)?;
        let progress = lock(&job.progress)?.clone();
        Ok(match outcome.as_ref() {
            None => Status { done: false, error: None, summary: None, progress },
            Some(Ok(summary)) => Status { done: true, error: None, summary: Some(summary.clone()), progress },
            Some(Err(error)) => Status { done: true, error: Some(error.clone()), summary: None, progress },
        })
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        if let Some(job) = lock(&self.0)?.remove(id) {
            job.cancel.store(true, Ordering::Release);
            // Drop the receiver to release queued packets and unblock the producer.
            lock(&job.receiver)?.take();
            lock(&job.semantics)?.take();
        }
        Ok(())
    }

    pub fn source_bytes(&self, id: &str) -> Result<Vec<u8>, String> {
        let job = self.get(id)?;
        let source = lock(&job.source)?;
        std::fs::read(source.path()).map_err(|e| e.to_string())
    }
}

impl Job {
    pub fn semantic_source(&self) -> Result<Vec<u8>, String> {
        let path = lock(&self.source)?.path().to_owned();
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let size = usize::try_from(file.metadata().map_err(|e| e.to_string())?.len())
            .map_err(|e| e.to_string())?;
        let mut source = Vec::with_capacity(size);
        let mut chunk = vec![0; INPUT_CHUNK_BYTES];
        loop {
            if self.cancel.load(Ordering::Acquire) { return Err("Native IFC job cancelled".into()); }
            let read = file.read(&mut chunk).map_err(|e| e.to_string())?;
            if read == 0 { break; }
            source.extend_from_slice(&chunk[..read]);
        }
        if self.cancel.load(Ordering::Acquire) { return Err("Native IFC job cancelled".into()); }
        Ok(source)
    }

    pub fn cancellation(&self) -> &AtomicBool { &self.cancel }

    pub fn set_semantics(&self, stream: crate::semantic::SemanticStream) -> Result<u64, String> {
        if self.cancel.load(Ordering::Acquire) { return Err("Native IFC job cancelled".into()); }
        let bytes = stream.byte_len()?;
        let mut guard = lock(&self.semantics)?;
        if self.cancel.load(Ordering::Acquire) { return Err("Native IFC job cancelled".into()); }
        *guard = Some(stream);
        Ok(bytes)
    }

    pub fn next_semantic_packet(&self) -> Result<Vec<u8>, String> {
        let mut guard = lock(&self.semantics)?;
        let stream = guard.as_mut().ok_or("Native semantic stream is not ready")?;
        stream.next_packet(INPUT_CHUNK_BYTES)
    }
}

impl Drop for Jobs {
    fn drop(&mut self) {
        if let Ok(jobs) = self.0.get_mut() {
            for job in jobs.values() { job.cancel.store(true, Ordering::Release); }
        }
    }
}

#[cfg(test)]
#[path = "native_tests.rs"]
mod tests;
