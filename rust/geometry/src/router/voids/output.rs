// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Shared void output paths, preserving sub-mesh identity and final hygiene.
use super::{GeometryRouter, SourceHygiene};
use crate::{Mesh, Result, SubMesh, SubMeshCollection};
use ifc_lite_core::{DecodedEntity, EntityDecoder};
use rustc_hash::FxHashMap;

impl GeometryRouter {

    /// [`Self::process_element_with_voids`] over the element's frame parts
    /// ([`Self::process_element_parts`]): each part is cut by the same openings,
    /// classified once. An ordinary element has exactly one part (#6349).
    pub fn process_element_with_voids_parts(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &FxHashMap<u32, Vec<u32>>,
    ) -> Result<Vec<Mesh>> {
        if let Some(out) = self.try_source_frame(element, decoder, void_index, |router, decoder| {
            router.process_element_with_voids_parts(element, decoder, void_index)
        }) { return Ok(out); }

        let opening_ids = match void_index.get(&element.id) {
            Some(ids) if !ids.is_empty() => ids,
            _ => {
                return self.process_element_parts(element, decoder);
            }
        };

        let mut parts =
            self.process_element_parts_with_hygiene(element, decoder, SourceHygiene::IndexOnly)?;
        if let Some(precision)=self.precision_frame {
            for part in &mut parts {
                if !super::source_hygiene::repair_closed_input(part,precision){return Err(crate::Error::geometry("manufacturing stock has no closed source mesh".to_owned()));}
            }
        }
        // Opening and clip geometry are resolved in world coordinates, the
        // frame every part is in once placement has been applied.
        let ctx = self.build_void_context(element, opening_ids, decoder);
        Ok(parts
            .into_iter()
            .map(|part| {
                let mut voided = self.apply_void_context(part, &ctx, element.id);
                // Clean slivers the CSG cut can introduce at opening seams — same
                // hygiene as the tessellation chokepoints (Mesh::clean_degenerate).
                if self.precision_frame.is_some() { super::source_hygiene::clean(&mut voided); }
                else {voided.clean_degenerate();}
                // Instancing: a void-cut mesh no longer reproduces its representation's
                // canonical geometry, so it can never be shared. Drop any metadata that
                // rode along from the (pre-cut) mapped item.
                voided.instance_meta = None;
                voided
            })
            .collect())
    }

    /// Process an element into per-item sub-meshes with opening subtraction.
    ///
    /// Mirrors [`process_element_with_voids`] but preserves each
    /// `IfcShapeRepresentation` item as its own sub-mesh so that callers can
    /// look up a direct `IfcStyledItem` color per geometry item (e.g. the
    /// three extrusion layers of a multi-layer wall). The opening(s) are
    /// subtracted from each sub-mesh independently so that windows and doors
    /// cut through every material layer they intersect.
    ///
    /// Returns an empty collection when there are no openings (callers should
    /// fall back to [`process_element_with_submeshes`]) or when every
    /// sub-mesh is destroyed by void subtraction.
    pub fn process_element_with_submeshes_and_voids(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &FxHashMap<u32, Vec<u32>>,
    ) -> Result<SubMeshCollection> {
        if let Some(out) = self.try_source_frame(element, decoder, void_index, |router, decoder| {
            router.process_element_with_submeshes_and_voids(element, decoder, void_index)
        }) { return Ok(out); }

        // Layered single-solid path: slice the element's base mesh by its
        // material-layer buildup AFTER subtracting voids. This produces one
        // sub-mesh per layer keyed by IfcMaterial id, so layers show up as
        // individual colors even when the underlying geometry is a single
        // swept solid.
        if let Some(layered) = self.try_layered_sub_meshes(element, decoder, Some(void_index)) {
            return Ok(layered);
        }

        let opening_ids = match void_index.get(&element.id) {
            Some(ids) if !ids.is_empty() => ids.clone(),
            _ => return Ok(SubMeshCollection::new()),
        };

        // Voided occurrences materialize cut geometry (#1623 don't-bake off) with no
        // texture index (#1781: CSG rebuilds vertices, orphaning UVs — colour wins).
        let mut sub_meshes = self.process_element_with_submeshes_impl(
            element,
            decoder,
            false,
            None,
            SourceHygiene::IndexOnly,
        )?;
        if sub_meshes.is_empty() {
            return Ok(SubMeshCollection::new());
        }
        if let Some(precision)=self.precision_frame {
            for part in &mut sub_meshes.sub_meshes {
                if !super::source_hygiene::repair_closed_input(&mut part.mesh,precision){return Err(crate::Error::geometry("manufacturing stock has no closed source mesh".to_owned()));}
            }
        }

        // Classify openings + resolve clipping planes ONCE per element. Doing
        // this per sub-mesh would re-run `process_element` on every opening
        // and re-extract clipping planes N times, multiplying the expensive
        // parsing/CSG setup by the sub-mesh count on the exact elements this
        // path targets (multi-layer walls with windows).
        let ctx = self.build_void_context(element, &opening_ids, decoder);

        // INHERIT the discriminator rather than assuming rep-item ids. This path
        // is reached only when `try_layered_sub_meshes` declined above, so the
        // flag is false today -- but hard-coding that would make a future
        // layered producer silently relabel material ids as representation
        // items, which is the exact confusion #3199 removes.
        let mut voided = SubMeshCollection {
            sub_meshes: Vec::new(),
            ids_are_materials: sub_meshes.ids_are_materials,
        };
        for sub in sub_meshes.sub_meshes {
            let geometry_id = sub.geometry_id;
            let mut voided_mesh = self.apply_void_context(sub.mesh, &ctx, element.id);
            // Same CSG-seam hygiene as the single-mesh void path.
            if self.precision_frame.is_some() { super::source_hygiene::clean(&mut voided_mesh); }
            else {voided_mesh.clean_degenerate();}
            if !voided_mesh.is_empty() {
                voided
                    .sub_meshes
                    .push(SubMesh::new(geometry_id, voided_mesh));
            }
        }

        Ok(voided)
    }
}
