<<<<<<< custom-r7
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Router construction kept separate from routing and shared caches.
use super::*;
impl GeometryRouter {
    /// Create new router with default processors
    pub fn new() -> Self {
        // Routing metadata is immutable through this API. Keep one default
        // per process/wasm instance; processor diagnostics remain router-local.
        static SCHEMA: OnceLock<IfcSchema> = OnceLock::new();
        let schema = SCHEMA.get_or_init(IfcSchema::new);
        Self {
            schema,
            processors: ProcessorRegistry::new(),
            mapped_item_cache: RefCell::new(FxHashMap::default()),
            shared_mapped_item_cache: None, // armed by `enable_shared_mapped_item_cache`
            geometry_hash_cache: RefCell::new(FxHashMap::default()),
            item_dedup_cache: None, // armed by `with_units` / `enable_content_dedup_shared`
            content_sig_memo: RefCell::new(FxHashMap::default()),
            shared_brep_signatures: None,
            content_hash_oversized_ref_drops: RefCell::new(0),
            unit_scale: 1.0,             // Default to base meters
            rtc_offset: (0.0, 0.0, 0.0), // Default to no offset
            local_frame_enabled: None,
            precision_frame: None,
            source_frame_active: false,
            source_boundary_verdict: std::cell::Cell::new(None),
            material_layer_index: None,
            csg_failures: RefCell::new(FxHashMap::default()),
            classification_stats: RefCell::new(ClassificationStats::default()),
            host_opening_diagnostics: RefCell::new(FxHashMap::default()),
            rect_fast_stats: RefCell::new(crate::rect_fast::RectFastStats::default()),
            layer_slice_diag: RefCell::new(Vec::new()),
            voids_consumed_hosts: RefCell::new(FxHashSet::default()),
            tessellation_quality: TessellationQuality::Medium,
            skip_small_cuts: false,
            output_instancing_plan: None, // armed by `enable_output_instancing`
            indexed_colour_split_ids: None, // armed by `enable_indexed_colour_split_guard`
            preserve_triangle_order: std::cell::Cell::new(false),
            instancing_batch_local: false, // native global-template mode by default
            instanced_sources_materialized: RefCell::new(FxHashSet::default()),
            unsupported: RefCell::new(Default::default()),
        }
    }

}
||||||| previous-upstream
=======
// SPDX-License-Identifier: MPL-2.0
use super::GeometryRouter;
use crate::{construction::ConstructionBatch, Result};
use ifc_lite_core::EntityDecoder;

impl GeometryRouter {
    /// Plan raw representation-item constructions with this router's quality
    /// and extension-dispatch policy. The item limit bounds root scheduling,
    /// not memory. Unlowered constructors and custom processors are explicit
    /// requirements; they prevent batch evaluation. See [`ConstructionBatch`]
    /// for the file-unit coordinate and intentionally partial coverage contract.
    pub fn plan_construction_items(
        &self,
        decoder: &mut EntityDecoder,
        roots: &[u32],
        max_items: usize,
    ) -> Result<ConstructionBatch> {
        ConstructionBatch::compile(self, self.schema, decoder, roots, max_items)
    }
}
>>>>>>> github-main
