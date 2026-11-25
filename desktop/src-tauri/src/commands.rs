// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use ifc_lite_desktop::native::{Jobs, Status};
use tauri::{ipc::{InvokeBody, Request, Response}, State};

#[tauri::command]
pub fn native_backend_info() -> serde_json::Value {
    serde_json::json!({ "engine": "ifc-lite-processing", "engineVersion": "20.3.0",
        "pointerBits": usize::BITS, "packetVersion": 1, "queuedPackets": 2 })
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
pub async fn native_data_model(id: String, rooted_only: Option<bool>, jobs: State<'_, Jobs>) -> Result<serde_json::Value, String> {
    // The source lives in Rust. No full IFC buffer or JSON byte array is sent
    // into the WebView. Serialize only the semantic tables the viewer consumes.
    let source = jobs.source_bytes(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        use crate::services::data_model::DataModelEntities;
        let scope = if rooted_only == Some(true) { DataModelEntities::Rooted } else { DataModelEntities::All };
        let mut model = crate::services::data_model::extract_data_model(&source);
        scope.apply(&mut model);
        serde_json::json!({ "entityScope": format!("entities{}", scope.cache_infix()),
            "entities": model.entities, "propertySets": model.property_sets,
            "quantitySets": model.quantity_sets, "relationships": model.relationships,
            "classifications": model.classifications, "materials": model.materials,
            "documents": model.documents, "spatialHierarchy": model.spatial_hierarchy })
    }).await.map_err(|e| format!("Native semantic extraction failed: {e}"))
}
