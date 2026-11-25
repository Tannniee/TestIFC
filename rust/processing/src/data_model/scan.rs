// SPDX-License-Identifier: MPL-2.0
//! One bounded scan supplies semantic jobs and their canonical byte index.
use super::*;

pub(super) struct Scanned<'a> {
    pub index: Arc<ifc_lite_core::EntityIndex>,
    pub jobs: Vec<EntityJob<'a>>,
}

pub(super) fn scan_jobs<'a>(content: &'a [u8], scope: DataModelEntities,
    cancel: Cancellation<'_>, extract_start: std::time::Instant,
) -> Result<Scanned<'a>, ExtractionCancelled> {
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
                let skip = slots::RootSlots::for_type(type_name).is_some_and(|slots| slots.global_id.is_none());
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
    Ok(Scanned { index: entity_index, jobs: all_entities })
}
