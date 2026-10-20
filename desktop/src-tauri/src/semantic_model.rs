// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use crate::services::data_model::{extract_data_model_scoped_cancellable, DataModelEntities};
use ifc_lite_desktop::{native::Job, semantic::{record, SemanticStream}};
use std::sync::atomic::Ordering;

pub fn prepare(job: &Job, rooted: bool) -> Result<u64, String> {
    if job.cancellation().load(Ordering::Acquire) { return Err("Native IFC job cancelled".into()); }
    let source = job.semantic_source()?;
    let scope = if rooted { DataModelEntities::Rooted } else { DataModelEntities::All };
    let model = extract_data_model_scoped_cancellable(&source, scope, job.cancellation())
        .map_err(|error| error.to_string())?;
    let stream = SemanticStream::encode(|writer| {
        macro_rules! rows {
            ($label:literal, $rows:expr) => {
                for row in $rows { record(writer, $label, &row, job.cancellation())?; }
            };
        }
        record(writer, "entityScope", &format!("entities{}", scope.cache_infix()), job.cancellation())?;
        rows!("projectUnits", &model.project_units);
        rows!("entities", &model.entities);
        rows!("propertySets", &model.property_sets);
        rows!("quantitySets", &model.quantity_sets);
        rows!("relationships", &model.relationships);
        rows!("classifications", &model.classifications);
        rows!("materials", &model.materials);
        rows!("documents", &model.documents);
        let spatial = &model.spatial_hierarchy;
        record(writer, "projectId", &spatial.project_id, job.cancellation())?;
        rows!("spatialNodes", &spatial.nodes);
        rows!("elementToStorey", &spatial.element_to_storey);
        rows!("elementToBuilding", &spatial.element_to_building);
        rows!("elementToSite", &spatial.element_to_site);
        rows!("elementToSpace", &spatial.element_to_space);
        record(writer, "complete", &true, job.cancellation())
    })?;
    job.set_semantics(stream)
}
