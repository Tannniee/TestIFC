// SPDX-License-Identifier: MPL-2.0
//! Opt-in product recolouring; the canonical STEP writer owns serialization.
mod catalog;
mod paint;
mod source;
use serde::{Deserialize, Serialize};
pub use catalog::catalog_colorizer;
pub use paint::plan_colorizer;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GroupBy { #[default] Section, Class, Material, Storey, Property }

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorizerGrouping {
    #[serde(default)] pub mode: GroupBy,
    #[serde(default)] pub property: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorizerBatch { pub products: Vec<u32>, pub color: [f64; 4] }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorizerRequest { pub batches: Vec<ColorizerBatch> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorizerGroup {
    pub name: String,
    pub source: String,
    pub products: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorizerCatalog {
    pub schema: String,
    pub product_ids: Vec<u32>,
    pub groups: Vec<ColorizerGroup>,
}

/// Author colour edits with the same writer used by ordinary Rust STEP exports.
pub fn export_colorized_ifc(bytes: &[u8], request: &ColorizerRequest) -> Result<String, String> {
    let log = plan_colorizer(bytes, request)?;
    let (result, stats) = crate::export_step_with_log(bytes, &crate::StepOptions::default(), &log)
        .map_err(|e| e.to_string())?;
    if !stats.warnings.is_empty() { return Err(format!("Colour export refused: {}", stats.warnings.join("; "))); }
    Ok(result)
}

#[cfg(test)]
mod tests;
