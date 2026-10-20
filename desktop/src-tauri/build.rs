// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
fn main() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Cargo.toml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let source = std::fs::read_to_string(&manifest).expect("read the core workspace manifest");
    let workspace: toml::Table = toml::from_str(&source).expect("parse the core workspace manifest");
    let version = workspace["workspace"]["package"]["version"].as_str()
        .expect("the core workspace must declare its package version");
    println!("cargo:rustc-env=IFCLITE_ENGINE_VERSION={version}");
    tauri_build::build();
}
