// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Data model extraction service - extracts properties, relationships, and spatial hierarchy.

mod cancellation;
mod classifications;
mod documents;
mod jobs;
mod materials;
mod material_units;
mod material_usages;
mod metadata;
pub mod property;
pub mod quantity;
pub mod render;
pub mod rows;
pub mod spatial_walk;
pub mod type_assignments;
mod inherit;
mod properties;
mod property_value;
mod project_units;
mod quantities;
mod relationships;
mod rooted;
mod slots;
mod spatial;
mod types;

pub use cancellation::ExtractionCancelled;
use cancellation::Cancellation;
pub use rooted::DataModelEntities;
pub use types::*;
pub use project_units::ProjectUnitAssignment;

use classifications::extract_classifications;
use documents::extract_documents;
use ifc_lite_core::{
<<<<<<< custom-r7
    extract_length_unit_scale, DecodedEntity, EntityDecoder, EntityScanner,
||||||| previous-upstream
    build_entity_index, extract_length_unit_scale, DecodedEntity, EntityDecoder, EntityScanner,
=======
    build_entity_index, DecodedEntity, EntityDecoder, EntityScanner,
>>>>>>> github-main
};
use jobs::JobBuckets;
use materials::extract_materials;
use material_units::MaterialUnitContext;
use metadata::extract_entity_metadata;
use properties::extract_properties;
use quantities::extract_quantities;
use relationships::extract_relationships;
use spatial::build_spatial_hierarchy_cancellable;
use std::sync::{Arc, atomic::AtomicBool};
use rustc_hash::FxHashMap;

/// Extract complete data model from IFC content.
pub fn extract_data_model<T>(content: &T) -> DataModel
where
    T: AsRef<[u8]> + ?Sized,
{
    extract_data_model_scoped(content, DataModelEntities::All)
}

/// Apply the entities scope before decoding geometry plumbing. The rooted wire
/// stays identical to filtering a complete model, without creating millions of
/// unused metadata rows (or a second complete copy of the source).
pub fn extract_data_model_scoped<T>(content: &T, scope: DataModelEntities) -> DataModel
where
    T: AsRef<[u8]> + ?Sized,
{
    extract_impl(content.as_ref(), scope, Cancellation(None))
        .expect("Extraction without a cancellation token cannot be cancelled")
}

/// Same canonical extraction as the server, with cooperative cancellation.
/// No partial model is returned: workers check between entities and referenced
/// property/quantity members, and publication checks every phase boundary.
// The native desktop compiles this module directly; the HTTP server has no token.
#[allow(dead_code)]
pub fn extract_data_model_scoped_cancellable<T>(
    content: &T, scope: DataModelEntities, cancel: &AtomicBool,
) -> Result<DataModel, ExtractionCancelled>
where T: AsRef<[u8]> + ?Sized,
{
    extract_impl(content.as_ref(), scope, Cancellation(Some(cancel)))
}

fn extract_impl(content: &[u8], scope: DataModelEntities, cancel: Cancellation<'_>)
    -> Result<DataModel, ExtractionCancelled>
{
    cancel.check()?;
    let extract_start = std::time::Instant::now();
    tracing::info!(
        content_size = content.len(),
        "Starting data model extraction"
    );

    // One canonical scanner supplies both offsets and metadata jobs. Grow by
    // actual row count: file bytes are a poor capacity estimate for huge rows.
    let mut index = ifc_lite_core::EntityIndex::default();
    let mut rooted_types: FxHashMap<String, bool> = FxHashMap::default();

    // Scan all entities once
    let mut scanner = EntityScanner::new(content);
    let mut all_entities: Vec<EntityJob> = Vec::new();
    let mut total_entities = 0usize;

    let mut last_id = 0u32;
    let mut last_type = "";
    let mut max_id = 0u32;
    let mut last_end = 0usize;
    let content_len = content.len();

    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        cancel.check()?;
        index.insert(id, (start, end));
        total_entities += 1;
        last_id = id;
        last_type = type_name;
        last_end = end;
        if id > max_id {
            max_id = id;
        }
        let skip = scope == DataModelEntities::Rooted && match rooted_types.get(type_name) {
            Some(&skip) => skip,
            None => {
                let skip = generated::root_attr_indices(&type_name.to_ascii_uppercase())
                    .is_some_and(|indices| indices.global_id < 0);
                rooted_types.insert(type_name.to_string(), skip);
                skip
            }
        };
        if skip {
            continue;
        }
        all_entities.push(EntityJob {
            id,
            type_name,
            start,
            end,
        });
    }

    ifc_lite_core::parser::report_scan_diagnostics(
        scanner.skipped_oversized_ids(), scanner.malformed_record_start().is_some());
    cancel.check()?;
    let entity_index = Arc::new(index);
    tracing::info!(elapsed_ms = extract_start.elapsed().as_millis(), total_entities, "Semantic scan complete");
    let remaining_bytes = content_len.saturating_sub(last_end);
    tracing::debug!(
        total_entities = total_entities,
        last_id = last_id,
        max_id = max_id,
        last_type = %last_type,
        last_end = last_end,
        content_len = content_len,
        remaining_bytes = remaining_bytes,
        "Scanned all entities"
    );

    log_scan_census(&all_entities);

<<<<<<< custom-r7
    // Each extractor borrows the source and observes native cancellation.
||||||| previous-upstream
    // Parallel extraction using rayon::join. Every extractor borrows the
    // content: `rayon::join` scopes the borrow, so the copy of the whole
    // upload this used to make (up to `MAX_FILE_SIZE_MB`, on top of the parse
    // running beside it) bought nothing (#7676, SERVER-11).
=======
    // Parallel extraction using rayon::join. Every extractor borrows the
    // content: `rayon::join` scopes the borrow, so the copy of the whole
    // upload this used to make (up to `MAX_FILE_SIZE_MB`, on top of the parse
    // running beside it) bought nothing (#7676, SERVER-11).
    let buckets = JobBuckets::new(&all_entities);
>>>>>>> github-main
    let (entities, ((property_sets, quantity_sets), relationships)) = rayon::join(
        || extract_entity_metadata(&all_entities, content, &entity_index, cancel),
        || {
            rayon::join(
                || {
                    rayon::join(
<<<<<<< custom-r7
                        || extract_properties(&all_entities, content, &entity_index, cancel),
                        || extract_quantities(&all_entities, content, &entity_index, cancel),
||||||| previous-upstream
                        || extract_properties(&all_entities, content, &entity_index),
                        || extract_quantities(&all_entities, content, &entity_index),
=======
                        || extract_properties(&buckets.property_sets, content, &entity_index),
                        || extract_quantities(&buckets.quantity_sets, content, &entity_index),
>>>>>>> github-main
                    )
                },
                || extract_relationships(&all_entities, content, &entity_index, cancel),
            )
        },
    );

<<<<<<< custom-r7
    cancel.check()?;
    tracing::info!(elapsed_ms = extract_start.elapsed().as_millis(), "Semantic primary tables complete");
    // Extract length unit scale (e.g., 0.001 for millimeters)
||||||| previous-upstream
    // Extract length unit scale (e.g., 0.001 for millimeters)
=======
    // Extract length unit scale (e.g., 0.001 for millimeters) from the model's
    // project, found by the one locator. Data path: main's value, never a
    // refusal (#7678); the decoder is lossless.
>>>>>>> github-main
    let mut unit_decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
<<<<<<< custom-r7
    let project_id_for_units = entities
        .iter()
        .find(|e| e.type_name.eq_ignore_ascii_case("IFCPROJECT"))
        .map(|e| e.entity_id)
        .unwrap_or(0);
    let length_unit_scale = if project_id_for_units > 0 {
        extract_length_unit_scale(&mut unit_decoder, project_id_for_units).unwrap_or(1.0)
    } else {
        1.0
    };
    let project_units = entities.iter().filter(|e| e.type_name.eq_ignore_ascii_case("IFCPROJECT"))
        .map(|e| (e.entity_id, ProjectUnitAssignment::from(
            ifc_lite_core::project_units::ProjectUnits::resolve(&mut unit_decoder, e.entity_id))))
        .collect();
||||||| previous-upstream
    let project_id_for_units = entities
        .iter()
        .find(|e| e.type_name.to_uppercase() == "IFCPROJECT")
        .map(|e| e.entity_id)
        .unwrap_or(0);
    let length_unit_scale = if project_id_for_units > 0 {
        extract_length_unit_scale(&mut unit_decoder, project_id_for_units).unwrap_or(1.0)
    } else {
        1.0
    };
=======
    let project_ids = ifc_lite_core::find_project_ids(content);
    let length_unit_scale = unit_decoder.length_unit_scale();
>>>>>>> github-main
    tracing::debug!(
        length_unit_scale = length_unit_scale,
        "Extracted length unit scale"
    );
    let material_units = MaterialUnitContext::new(
<<<<<<< custom-r7
        &entities, &relationships, &mut unit_decoder, length_unit_scale, cancel,
||||||| previous-upstream
        &entities, &relationships, &mut unit_decoder, length_unit_scale,
=======
        &project_ids, &relationships, &mut unit_decoder, length_unit_scale,
>>>>>>> github-main
    );

    cancel.check()?;
    // Extract classifications, materials, and documents in parallel. These
    // follow the same `IfcRelAssociates*` pattern as the relationship pass but
    // resolve the referenced object (classification reference, material layer
    // set, document) into a flat, element-keyed shape (issue #900 parity).
    // Materials need the length-unit scale to report layer thickness in metres.
    let ((classifications, materials), documents) = rayon::join(
        || {
            rayon::join(
<<<<<<< custom-r7
                || extract_classifications(&all_entities, content, &entity_index, cancel),
||||||| previous-upstream
                || extract_classifications(&all_entities, content, &entity_index),
=======
                || extract_classifications(&buckets.rel_classifications, content, &entity_index),
>>>>>>> github-main
                || {
                    extract_materials(
                        &buckets.rel_materials,
                        content,
                        &entity_index,
                        &material_units,
                        cancel,
                    )
                },
            )
        },
<<<<<<< custom-r7
        || extract_documents(&all_entities, content, &entity_index, cancel),
||||||| previous-upstream
        || extract_documents(&all_entities, content, &entity_index),
=======
        || extract_documents(&buckets.rel_documents, content, &entity_index),
>>>>>>> github-main
    );

<<<<<<< custom-r7
    cancel.check()?;
    let mut model = DataModel { project_units, entities, property_sets, quantity_sets, relationships,
        classifications, materials, documents, spatial_hierarchy: SpatialHierarchyData {
            nodes: Vec::new(), project_id: 0, element_to_storey: Vec::new(),
            element_to_building: Vec::new(), element_to_site: Vec::new(), element_to_space: Vec::new(),
        } };
    if scope == DataModelEntities::Rooted {
        // Keep non-rooted relation/material endpoints too. Recover their jobs
        // from a bounded scan, rather than decoding all non-rooted instances.
        let mut missing = rooted::referenced_ids_cancellable(&model, cancel);
        cancel.check()?;
        for entity in &model.entities { cancel.check()?; missing.remove(&entity.entity_id); }
        let mut jobs = Vec::new();
        for id in missing {
            cancel.check()?;
            if let Some(&(start, end)) = entity_index.get(&id) {
                // Scan just this indexed record so unknown schema names and raw
                // byte offsets remain identical to the full-file scanner.
                let mut scanner = EntityScanner::new(&content[start..end]);
                if let Some((_, type_name, _, _)) = scanner.next_entity() {
                    jobs.push(EntityJob { id, type_name, start, end });
                }
            }
        }
        model.entities.extend(extract_entity_metadata(&jobs, content, &entity_index, cancel));
        cancel.check()?;
        model.entities.sort_by_key(|entity| entity_index.get(&entity.entity_id).map(|range| range.0));
    }
    cancel.check()?;
    // Build spatial hierarchy after resolving all referenced endpoints.
    let spatial_hierarchy = build_spatial_hierarchy_cancellable(
        &model.relationships,
        &model.entities,
||||||| previous-upstream
    // Build spatial hierarchy (depends on relationships and entities)
    let spatial_hierarchy = build_spatial_hierarchy(
        &relationships,
        &entities,
=======
    // A table over its budget is not served truncated: the refusal travels
    // with the model to the one serializer every route uses (#7675).
    let (materials, refused) = match materials {
        Ok(rows) => (rows, None),
        Err(reason) => (Vec::new(), Some(reason)),
    };

    // Build spatial hierarchy (depends on relationships and entities)
    let spatial_hierarchy = build_spatial_hierarchy(
        &relationships,
        &entities,
>>>>>>> github-main
        content,
        &entity_index,
        length_unit_scale,
        cancel,
    )?;

    cancel.check()?;
    model.spatial_hierarchy = spatial_hierarchy;
    scope.apply(&mut model);
    cancel.check()?;
    let extract_time = extract_start.elapsed();
    tracing::info!(
        entities = model.entities.len(),
        property_sets = model.property_sets.len(),
        quantity_sets = model.quantity_sets.len(),
        relationships = model.relationships.len(),
        classifications = model.classifications.len(),
        materials = model.materials.len(),
        documents = model.documents.len(),
        spatial_nodes = model.spatial_hierarchy.nodes.len(),
        extract_time_ms = extract_time.as_millis(),
        "Data model extraction complete"
    );

<<<<<<< custom-r7
    Ok(model)
||||||| previous-upstream
    DataModel {
        entities,
        property_sets,
        quantity_sets,
        relationships,
        classifications,
        materials,
        documents,
        spatial_hierarchy,
    }
=======
    DataModel {
        entities,
        property_sets,
        quantity_sets,
        relationships,
        classifications,
        materials,
        documents,
        spatial_hierarchy,
        refused,
    }
>>>>>>> github-main
}

/// Debug-level census of the scanned jobs, to diagnose a model that extracts
/// nothing. Costs nothing unless debug tracing is enabled.
fn log_scan_census(all_entities: &[EntityJob]) {
    if tracing::enabled!(tracing::Level::DEBUG) {
        let sample_types: Vec<&str> = all_entities
            .iter()
            .take(20)
            .map(|j| j.type_name)
            .collect();
        tracing::debug!(?sample_types, "Sample entity types from scan");

        // Check if any type contains "PROPERTY" or "REL" (case-insensitive)
        let has_property_like = all_entities
            .iter()
            .any(|j| j.type_name.to_uppercase().contains("PROPERTY"));
        let has_rel_like = all_entities
            .iter()
            .any(|j| j.type_name.to_uppercase().starts_with("IFCREL"));
        tracing::debug!(
            has_property_like = has_property_like,
            has_rel_like = has_rel_like,
            "Entity type pattern check"
        );

        // Debug: count property sets and relationships in scanned entities
        let pset_count = all_entities
            .iter()
            .filter(|j| j.type_name.to_uppercase() == "IFCPROPERTYSET")
            .count();
        let rel_count = all_entities
            .iter()
            .filter(|j| {
                let t = j.type_name.to_uppercase();
                t == "IFCRELDEFINESBYPROPERTIES"
                    || t == "IFCRELAGGREGATES"
                    || t == "IFCRELCONTAINEDINSPATIALSTRUCTURE"
            })
            .count();
        tracing::debug!(
            pset_count = pset_count,
            rel_count = rel_count,
            "Entity type counts before extraction"
        );
    }
}

/// Collect the `RelatedObjects` (attribute 4) entity ids of an `IfcRelAssociates*`.
pub(super) fn related_object_ids(rel: &DecodedEntity) -> Vec<u32> {
    rel.get_list(4)
        .map(|list| list.iter().filter_map(|v| v.as_entity_ref()).collect())
        .unwrap_or_default()
}


#[cfg(test)]
#[path = "tests.rs"]
mod tests;
