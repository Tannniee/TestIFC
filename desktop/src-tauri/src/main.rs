// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The UI host is exercised through packaged WebView2; Rust unit/integration
// tests live in the library and tests/. Match Cargo's test=false for this bin
// when clippy --all-targets also constructs a synthetic binary test harness.
#[cfg(not(test))]
mod commands;
#[cfg(not(test))]
pub mod services;
#[cfg(not(test))]
mod semantic_model;

#[cfg(not(test))]
fn main() {
    use tauri::Manager;
    tauri::Builder::default()
        .manage(ifc_lite_desktop::native::Jobs::default())
        .setup(|app| {
            if option_env!("VITE_IFCLITE_NATIVE") == Some("1") {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_title(&format!("IFC-Lite {} — Native Preview", env!("CARGO_PKG_VERSION")))?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::native_backend_info,
            commands::native_create_job, commands::native_append_source, commands::native_import_path,
            commands::native_start_job, commands::native_next_packet, commands::native_job_status,
            commands::native_close_job, commands::native_prepare_semantics,
            commands::native_next_semantic_packet, commands::native_colorizer_prepare,
            commands::native_colorizer_catalog, commands::native_colorizer_export,
            commands::native_colorizer_next_packet])
        .run(tauri::generate_context!())
        .expect("Unable to launch IFC-Lite desktop");
}
