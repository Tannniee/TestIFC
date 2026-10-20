// SPDX-License-Identifier: MPL-2.0
//! Reproduce Colorizer catalog/export without a GUI or an external IFC engine.
use ifc_lite_export::colorizer::{catalog_colorizer, export_colorized_ifc, ColorizerGrouping, ColorizerRequest};
fn main() -> Result<(),Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 5 { return Err("Usage: colorizer catalog|paint input.ifc request.json output".into()); }
    let bytes = std::fs::read(&args[2])?;
    let request = std::fs::read_to_string(&args[3])?;
    let result = match args[1].as_str() {
        "catalog" => serde_json::to_string_pretty(&catalog_colorizer(&bytes,&serde_json::from_str::<ColorizerGrouping>(&request)?)?)?,
        "paint" => export_colorized_ifc(&bytes,&serde_json::from_str::<ColorizerRequest>(&request)?)?,
        _ => return Err("Expected catalog or paint".into()),
    };
    std::fs::write(&args[4],result)?;
    Ok(())
}
