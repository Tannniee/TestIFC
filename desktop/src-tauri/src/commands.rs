// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use ifc_lite_desktop::native::{Jobs, Status};
use tauri::{ipc::{InvokeBody, Request, Response}, State};

#[tauri::command]
pub fn native_backend_info() -> serde_json::Value {
    serde_json::json!({ "engine": "ifc-lite-processing", "engineVersion": env!("IFCLITE_ENGINE_VERSION"),
        "pointerBits": usize::BITS, "packetVersion": 1, "instancedGeometry": true, "queuedPackets": 2 })
}

#[tauri::command]
pub fn native_create_job(jobs: State<'_, Jobs>) -> Result<String, String> { jobs.create() }

#[tauri::command]
pub fn native_append_source(request: Request<'_>, jobs: State<'_, Jobs>) -> Result<(), String> {
    let id = request.headers().get("x-ifc-job").and_then(|v| v.to_str().ok()).ok_or("Missing native job header")?;
    match request.body() {
        InvokeBody::Raw(bytes) => jobs.append(id, bytes),
        InvokeBody::Json(_) => Err("Native source upload requires a binary body".into()),
    }
}

#[tauri::command]
pub async fn native_import_path(path: String, jobs: State<'_, Jobs>) -> Result<String, String> {
    jobs.import_path(std::path::Path::new(&path))
}

#[tauri::command]
pub fn native_start_job(id: String, jobs: State<'_, Jobs>) -> Result<(), String> { jobs.start(&id) }

#[tauri::command]
pub fn native_next_packet(id: String, jobs: State<'_, Jobs>) -> Result<Response, String> {
    Ok(Response::new(jobs.next_packet(&id)?))
}

#[tauri::command]
pub fn native_job_status(id: String, jobs: State<'_, Jobs>) -> Result<Status, String> { jobs.status(&id) }

#[tauri::command]
pub fn native_close_job(id: String, jobs: State<'_, Jobs>) -> Result<(), String> { jobs.close(&id) }

#[tauri::command]
pub async fn native_prepare_semantics(id: String, rooted_only: Option<bool>, jobs: State<'_, Jobs>) -> Result<u64, String> {
    let job = jobs.get(&id)?;
    tauri::async_runtime::spawn_blocking(move || crate::semantic_model::prepare(&job, rooted_only == Some(true)))
        .await.map_err(|e| format!("Native semantic extraction failed: {e}"))?
}

#[tauri::command]
pub fn native_next_semantic_packet(id: String, jobs: State<'_, Jobs>) -> Result<Response, String> {
    Ok(Response::new(jobs.get(&id)?.next_semantic_packet()?))
}

#[tauri::command]
pub async fn native_colorizer_prepare(id: String, mutations: String, jobs: State<'_, Jobs>) -> Result<(),String> {
    let job = jobs.get(&id)?;
    tauri::async_runtime::spawn_blocking(move || ifc_lite_desktop::colorizer::prepare(&job,&mutations))
        .await.map_err(|e| format!("Colorizer source preparation failed: {e}"))?
}

#[tauri::command]
pub async fn native_colorizer_catalog(id: String, grouping: ifc_lite_export::colorizer::ColorizerGrouping, jobs: State<'_, Jobs>)
    -> Result<ifc_lite_export::colorizer::ColorizerCatalog,String> {
    let job = jobs.get(&id)?;
    tauri::async_runtime::spawn_blocking(move || ifc_lite_desktop::colorizer::catalog(&job,&grouping))
        .await.map_err(|e| format!("Colorizer discovery failed: {e}"))?
}

#[tauri::command]
pub async fn native_colorizer_export(id: String, request: ifc_lite_export::colorizer::ColorizerRequest, jobs: State<'_, Jobs>) -> Result<u64,String> {
    let job = jobs.get(&id)?;
    tauri::async_runtime::spawn_blocking(move || ifc_lite_desktop::colorizer::export(&job,&request))
        .await.map_err(|e| format!("Colorizer export failed: {e}"))?
}

#[tauri::command]
pub fn native_colorizer_next_packet(id: String, jobs: State<'_, Jobs>) -> Result<Response,String> {
    let job = jobs.get(&id)?;
    Ok(Response::new(ifc_lite_desktop::colorizer::next_packet(&job)?))
}
