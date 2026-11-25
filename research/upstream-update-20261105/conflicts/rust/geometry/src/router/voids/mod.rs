// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Void (opening) subtraction for one host against its classified openings
//! ([`VoidContext`]), as an ordered chain of statically dispatched stages:
//!
//! - A, whole-host strategies on the host as it arrived, first acceptance
//!   wins: ParamRect, Bool2d, Prism (`strategy::HOST_STAGES`). A residual a
//!   strategy leaves is cut by recursion on its result.
//! - The origin/frame step: the host's world bounds are captured and host and
//!   cutters are moved into one origin-0 frame.
//! - B, frame-local: WallLocalFrame (with its snapped retry), the facet weld,
//!   RectFast (`Execution::cut_in_frame`).
//! - C, the exact tail: dense-host refinement and cutter preparation, then the
//!   coaxial union, the disjoint batch, the sequential exact cut and the #635
//!   AABB fallback (`strategy::exact::ExactTail`).
//! - D, post passes on the exact cut: failure drain, sliver refinement,
//!   malformed recut, flap clip, the shard sweep when a pass changed the host,
//!   and the cut-effect record (`post::finish`).
//!
//! The order is part of the geometry and diagnostics contract
//! (`docs/architecture/mesh-determinism.md`); `stage_order_tests` pins it. The
//! stages record effects on the owned [`Execution`]; an empty cut is marked
//! consumed once, by `program::openings::execute`.

use super::processing::SourceHygiene;
use super::GeometryRouter;
#[cfg(test)]
use crate::csg::{ClippingProcessor, GroupCut};
<<<<<<< custom-r7
use crate::{Mesh, Point3, Result, TessellationQuality, Vector3};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
||||||| previous-upstream
use crate::mesh::{SubMesh, SubMeshCollection};
use crate::{Mesh, Point3, Result, TessellationQuality, Vector3};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
=======
use crate::mesh::SubMeshCollection;
use crate::program::openings::execute::Execution;
#[cfg(test)]
use crate::Point3;
use crate::{Mesh, Result, Vector3};
use ifc_lite_core::{DecodedEntity, EntityDecoder};
#[cfg(test)]
>>>>>>> github-main
use nalgebra::Matrix3;
use rustc_hash::FxHashMap;

mod aabb_clip;
mod admission;
mod context;
pub use context::RectParam;
pub(crate) use context::{ParamRectCut, VoidContext};
mod batch_cutter;
pub(crate) mod bool2d_path;
mod coaxial_union;
mod cutter;
pub(crate) mod geom;
mod malformed_opening_repair;
mod local_frame;
mod output;
mod source_frame;
mod source_exact;
mod boundary_conform;
mod source_hygiene;
mod source_retry;
mod convex_cut;
mod source_validation;
mod disjoint_groups;
mod source_batch;
mod source_plane;
mod precision_seams;
mod box_proof;
mod frame_snap;
pub(crate) mod hygiene;
pub(crate) mod prism_cut;
pub(crate) mod probe;
mod representation;
mod post;
mod staged;
mod strategy;
#[cfg(test)]
mod execution_tests_adapter;
mod synthesis;
pub use bool2d_path::take_bool2d_stats;
pub use prism_cut::{take_prism_defers, take_prism_stats};
#[cfg(test)]
mod reveal_tests;

pub(crate) use cutter::{CutterKind, OpeningFrame};
use geom::*;
use malformed_opening_repair::{cutter_is_closed_manifold, translate_cutter_mesh, world_host_bounds};
#[cfg(test)]
use malformed_opening_repair::{opening_obb_if_malformed, recut_malformed_openings, OpeningBox};
mod sweep;

/// Epsilon for normalizing direction vectors (guards against zero-length).
const NORMALIZE_EPSILON: f64 = 1e-12;
/// |cos| above which an authored cutter depth counts as the wall normal itself
/// (matches the vertical selector's 0.98 axis tolerance in `local_frame.rs`).
const WALL_NORMAL_DEPTH_COS: f64 = 0.98;
/// A mixed 2D + residual composition may inherit a small number of imperfect
/// IFC seams, but a large absolute increase signals that the second route tore
/// the re-extruded host. Below this floor the relative comparison still rules.
const MIXED_ROUTE_DEFECT_FLOOR: usize = 64;
const MIXED_ROUTE_DEFECT_GROWTH: usize = 4;

impl GeometryRouter {
    /// Process element with void subtraction (openings)
    /// Process element with voids using optimized plane clipping
    ///
    /// This approach is more efficient than full 3D CSG for rectangular openings:
    /// 1. Get chamfered wall mesh (preserves chamfered corners)
    /// 2. For each opening, use optimized box cutting with internal face generation
    /// 3. Apply any clipping operations (roof clips) from original representation
    ///
    /// Process an element with void subtraction (openings).
    ///
    /// This function handles three distinct cases for cutting openings:
    ///
    /// 1. **Floor/Slab openings** (vertical Z-extrusion): Uses CSG with actual mesh geometry
    ///    because the XY footprint may be rotated relative to the slab orientation.
    ///
    /// 2. **Wall openings** (horizontal X/Y-extrusion, axis-aligned): Uses AABB clipping
    ///    for fast, accurate cutting of rectangular openings.
    ///
    /// 3. **Diagonal wall openings**: Uses AABB clipping without internal face generation
    ///    to avoid rotation artifacts.
    ///
    /// Reveal faces (inner surfaces of the opening holes) are generated as a
    /// post-clipping step for rectangular and diagonal openings.  For diagonal
    /// walls the geometry is computed in a rotated axis-aligned frame and
    /// rotated back, giving correct results for any wall orientation.
    ///
    /// Errors when the element's body items cannot share one f64 frame
    /// (#6349); [`Self::process_element_with_voids_parts`] keeps them.
    #[inline]
    pub fn process_element_with_voids(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &FxHashMap<u32, Vec<u32>>,
    ) -> Result<Mesh> {
        let parts = self.process_element_with_voids_parts(element, decoder, void_index)?;
        super::frame_parts::single_frame(element.id, parts)
    }

<<<<<<< custom-r7

    /// Classify openings and extract clipping planes for an element.
    ///
    /// This is the expensive half of void subtraction — it decodes every
    /// `IfcOpeningElement` (running `process_element` on each), classifies
    /// them as rectangular / diagonal / non-rectangular, merges adjacent
    /// rectangles, and transforms clipping planes to world space. The
    /// output is reusable across every sub-mesh of the same element.
    pub(super) fn build_void_context(
        &self,
        element: &DecodedEntity,
        opening_ids: &[u32],
        decoder: &mut EntityDecoder,
    ) -> VoidContext {
        // NOTE (issue #635): we no longer extract `IfcBooleanClippingResult`
        // planes here. They are applied by `BooleanClippingProcessor::process`
        // when building the input mesh (the wall-inversion fix in
        // `processors/boolean.rs` makes the bounded-prism construction
        // correct per IFC); re-applying them as unbounded planes discarded
        // the polygonal bound and chopped off gable peaks (see
        // `apply_void_context` for the full rationale).
        let openings = self.classify_openings(element, opening_ids, decoder);
        let merged_openings = Self::merge_rectangular_openings(&openings);

        // PARAMETRIC fast-path capture (flag-gated, zero cost when off): probe the
        // host + every opening for an exact rectangular box, reconcile each opening
        // box against its mesh, and require all openings to share the host frame. Any
        // miss -> `None` -> the host defers to the exact kernel.
        let param = if crate::rect_fast::param_enabled() {
            self.capture_param_rect(element, opening_ids, decoder)
        } else {
            None
        };

        // 2D opening-subtraction capture (flag-gated). Cheap when it misses
        // (profile recovery only, no meshing), tried after the rect parametric
        // path in `apply_void_context` so rect+rect hosts keep their existing
        // output byte-identical and only the arbitrary-profile / rect-declined
        // hosts reach the 2D re-extrude.
        let bool2d = if bool2d_path::enabled() {
            self.capture_bool2d(element, opening_ids, decoder)
        } else {
            None
        };

        VoidContext {
            openings,
            merged_openings,
            param,
            bool2d,
        }
    }

    /// Build the parametric-cut data for a host + its openings, or `None` if any
    /// precondition fails (host/opening not a clean rect extrusion, opening box
    /// disagrees with its mesh, or an opening does not share the host frame).
    fn capture_param_rect(
        &self,
        element: &DecodedEntity,
        opening_ids: &[u32],
        decoder: &mut EntityDecoder,
    ) -> Option<ParamRectCut> {
        if opening_ids.is_empty() {
            return None;
        }
        let host = self.parametric_rect_probe(element, decoder)?;
        let rt = host.r.transpose();
        let mut openings = Vec::with_capacity(opening_ids.len());
        for &oid in opening_ids {
            let opening = decoder.decode_by_id(oid).ok()?;
            if !opening.ifc_type.is_subtype_of(IfcType::IfcFeatureElementSubtraction) {
                return None;
            }
            // An opening may be a UNION OF RECTANGULAR PRISMS (Tekla multi-solid). Extract
            // every box; each must share the host frame (signed permutation).
            let op_boxes = self.parametric_rect_probe_all(&opening, decoder)?;
            for op in &op_boxes {
                signed_permutation_map(&(rt * op.r), 1.0e-3)?;
            }
            // Reconcile the boxes against the meshed opening by VOLUME: the boxes must
            // account for the opening solid (catches non-rect / overlapping / partial parts).
            if !self.opening_boxes_reconcile(&opening, &op_boxes, decoder) {
                return None;
            }
            openings.extend(op_boxes);
        }
        Some(ParamRectCut { host, openings })
    }

    /// True iff the parametric `boxes` account for the actual meshed opening by VOLUME
    /// (Σ box volume ≈ Σ mesh-shell volume within 3%). For a union of non-overlapping
    /// rectangular prisms (the Tekla multi-solid opening) the mesh volume equals the
    /// box-volume sum; a mismatch flags a non-rect / overlapping / partial part → defer.
    fn opening_boxes_reconcile(
        &self,
        opening: &DecodedEntity,
        boxes: &[RectParam],
        decoder: &mut EntityDecoder,
    ) -> bool {
        if boxes.is_empty() {
            return false;
        }
        let Ok(meshes) = self.get_opening_item_meshes_world(opening, decoder) else {
            return false;
        };
        let mesh_vol: f64 = meshes.iter().map(|m| mesh_signed_volume(m).abs()).sum();
        if mesh_vol < 1.0e-9 {
            return false;
        }
        let box_vol: f64 = boxes
            .iter()
            .map(|b| 8.0 * b.half[0] * b.half[1] * b.half[2])
            .sum();
        let ratio = box_vol / mesh_vol;
        (0.97..1.03).contains(&ratio)
||||||| previous-upstream
    /// [`Self::process_element_with_voids`] over the element's frame parts
    /// ([`Self::process_element_parts`]): each part is cut by the same openings,
    /// classified once. An ordinary element has exactly one part (#6349).
    pub fn process_element_with_voids_parts(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &FxHashMap<u32, Vec<u32>>,
    ) -> Result<Vec<Mesh>> {
        let opening_ids = match void_index.get(&element.id) {
            Some(ids) if !ids.is_empty() => ids,
            _ => {
                return self.process_element_parts(element, decoder);
            }
        };

        let parts =
            self.process_element_parts_with_hygiene(element, decoder, SourceHygiene::IndexOnly)?;
        // Opening and clip geometry are resolved in world coordinates, the
        // frame every part is in once placement has been applied.
        let ctx = self.build_void_context(element, opening_ids, decoder);
        Ok(parts
            .into_iter()
            .map(|part| {
                let mut voided = self.apply_void_context(part, &ctx, element.id);
                // Clean slivers the CSG cut can introduce at opening seams — same
                // hygiene as the tessellation chokepoints (Mesh::clean_degenerate).
                voided.clean_degenerate();
                // Instancing: a void-cut mesh no longer reproduces its representation's
                // canonical geometry, so it can never be shared. Drop any metadata that
                // rode along from the (pre-cut) mapped item.
                voided.instance_meta = None;
                voided
            })
            .collect())
    }

    /// Classify openings and extract clipping planes for an element.
    ///
    /// This is the expensive half of void subtraction — it decodes every
    /// `IfcOpeningElement` (running `process_element` on each), classifies
    /// them as rectangular / diagonal / non-rectangular, merges adjacent
    /// rectangles, and transforms clipping planes to world space. The
    /// output is reusable across every sub-mesh of the same element.
    pub(super) fn build_void_context(
        &self,
        element: &DecodedEntity,
        opening_ids: &[u32],
        decoder: &mut EntityDecoder,
    ) -> VoidContext {
        // NOTE (issue #635): we no longer extract `IfcBooleanClippingResult`
        // planes here. They are applied by `BooleanClippingProcessor::process`
        // when building the input mesh (the wall-inversion fix in
        // `processors/boolean.rs` makes the bounded-prism construction
        // correct per IFC); re-applying them as unbounded planes discarded
        // the polygonal bound and chopped off gable peaks (see
        // `apply_void_context` for the full rationale).
        let openings = self.classify_openings(element, opening_ids, decoder);
        let merged_openings = Self::merge_rectangular_openings(&openings);

        // PARAMETRIC fast-path capture (flag-gated, zero cost when off): probe the
        // host + every opening for an exact rectangular box, reconcile each opening
        // box against its mesh, and require all openings to share the host frame. Any
        // miss -> `None` -> the host defers to the exact kernel.
        let param = if crate::rect_fast::param_enabled() {
            self.capture_param_rect(element, opening_ids, decoder)
        } else {
            None
        };

        // 2D opening-subtraction capture (flag-gated). Cheap when it misses
        // (profile recovery only, no meshing), tried after the rect parametric
        // path in `apply_void_context` so rect+rect hosts keep their existing
        // output byte-identical and only the arbitrary-profile / rect-declined
        // hosts reach the 2D re-extrude.
        let bool2d = if bool2d_path::enabled() {
            self.capture_bool2d(element, opening_ids, decoder)
        } else {
            None
        };

        VoidContext {
            openings,
            merged_openings,
            param,
            bool2d,
        }
    }

    /// Build the parametric-cut data for a host + its openings, or `None` if any
    /// precondition fails (host/opening not a clean rect extrusion, opening box
    /// disagrees with its mesh, or an opening does not share the host frame).
    fn capture_param_rect(
        &self,
        element: &DecodedEntity,
        opening_ids: &[u32],
        decoder: &mut EntityDecoder,
    ) -> Option<ParamRectCut> {
        if opening_ids.is_empty() {
            return None;
        }
        let host = self.parametric_rect_probe(element, decoder)?;
        let rt = host.r.transpose();
        let mut openings = Vec::with_capacity(opening_ids.len());
        for &oid in opening_ids {
            let opening = decoder.decode_by_id(oid).ok()?;
            if opening.ifc_type != IfcType::IfcOpeningElement {
                return None;
            }
            // An opening may be a UNION OF RECTANGULAR PRISMS (Tekla multi-solid). Extract
            // every box; each must share the host frame (signed permutation).
            let op_boxes = self.parametric_rect_probe_all(&opening, decoder)?;
            for op in &op_boxes {
                signed_permutation_map(&(rt * op.r), 1.0e-3)?;
            }
            // Reconcile the boxes against the meshed opening by VOLUME: the boxes must
            // account for the opening solid (catches non-rect / overlapping / partial parts).
            if !self.opening_boxes_reconcile(&opening, &op_boxes, decoder) {
                return None;
            }
            openings.extend(op_boxes);
        }
        Some(ParamRectCut { host, openings })
    }

    /// True iff the parametric `boxes` account for the actual meshed opening by VOLUME
    /// (Σ box volume ≈ Σ mesh-shell volume within 3%). For a union of non-overlapping
    /// rectangular prisms (the Tekla multi-solid opening) the mesh volume equals the
    /// box-volume sum; a mismatch flags a non-rect / overlapping / partial part → defer.
    fn opening_boxes_reconcile(
        &self,
        opening: &DecodedEntity,
        boxes: &[RectParam],
        decoder: &mut EntityDecoder,
    ) -> bool {
        if boxes.is_empty() {
            return false;
        }
        let Ok(meshes) = self.get_opening_item_meshes_world(opening, decoder) else {
            return false;
        };
        let mesh_vol: f64 = meshes.iter().map(|m| mesh_signed_volume(m).abs()).sum();
        if mesh_vol < 1.0e-9 {
            return false;
        }
        let box_vol: f64 = boxes
            .iter()
            .map(|b| 8.0 * b.half[0] * b.half[1] * b.half[2])
            .sum();
        let ratio = box_vol / mesh_vol;
        (0.97..1.03).contains(&ratio)
=======
    /// [`Self::process_element_with_voids`] over the element's frame parts
    /// ([`Self::process_element_parts`]): each part is cut by the same openings,
    /// classified once. An ordinary element has exactly one part (#6349).
    pub fn process_element_with_voids_parts(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &FxHashMap<u32, Vec<u32>>,
    ) -> Result<Vec<Mesh>> {
        // The host walk, its void context and each part's cut: the common
        // program's void control. With no openings it is the plain walk.
        let opening_ids = void_index.get(&element.id).map(Vec::as_slice).unwrap_or_default();
        crate::program::GeometryProgram::voided(element, opening_ids).drain_parts(self, decoder)
>>>>>>> github-main
    }
}

impl Execution {
    /// Apply a pre-built `VoidContext` to a single mesh.
    ///
    /// This is the cheap per-mesh half of void subtraction: it re-reads the
    /// mesh bounds (which differ per sub-mesh), extends rectangular openings
    /// along their extrusion axis so they fully penetrate the mesh, then
    /// subtracts every opening through the unified exact-kernel path (with the
    /// per-opening #635 AABB fallback). All the classification work has
    /// already been done by the owned host-opening control.
    ///
    /// `element_id` is the IFC product express ID of the host element. Any
    /// `BoolFailure` recorded by the inner CSG kernel is attributed to that
    /// product and stored on the router (drainable via
    /// [`GeometryRouter::take_csg_failures`]). The router's failure log is
    /// the only path failures reach the caller; `apply_void_context` itself
    /// always returns the (possibly un-cut) mesh.
    /// Apply a pre-built `VoidContext`, honouring the host's per-element local
    /// frame.
    ///
    /// When local-frame precision is on, the host mesh arrives stored relative
    /// to `mesh.origin` (small, f32-exact). The CSG must run with host AND
    /// cutters in that SAME frame, or the cutters (resolved in world coords)
    /// won't overlap the local host and every cut silently drops — the
    /// 222692→190201 regression from the first attempt. This wrapper strips the
    /// origin off the host (so the inner body works in a pure origin-0 local
    /// frame with no origin-aware-merge surprises), relativizes the cutters by
    /// the same origin, runs the CSG, then re-stamps the origin on the result so
    /// `world = origin + position` holds for the renderer.
    pub(crate) fn apply_void_context(
        &self,
        mut mesh: Mesh,
        ctx: &VoidContext,
        element_id: u32,
    ) -> Mesh {
<<<<<<< custom-r7
        // PARAMETRIC fast path (flag-gated). ORIGIN-AWARE: it handles both the world
        // mesh (origin 0, native default) AND a per-element local-frame mesh (origin != 0,
        // the wasm default — the precision-critical case this path is FOR), since it
        // builds its own frame from the parametrics. Any miss falls through to the exact
        // kernel below unchanged.
        if crate::rect_fast::param_enabled() && self.precision_frame.is_none() {
            if let Some(fast) = self.try_param_rect_cut(&mesh, ctx) {
                return fast;
            }
        }

        // 2D OPENING-SUBTRACTION fast path (flag-gated). Generalises the rect
        // parametric path above to arbitrary extruded-host profiles: subtract the
        // openings' footprints from the host's 2D profile and re-extrude. Tried
        // after `try_param_rect_cut` so proven rect+rect outputs are unchanged;
        // ORIGIN-AWARE (it builds its own world frame from the parametrics and
        // reconciles against the real host mesh, whatever `mesh.origin`). Any miss
        // falls through to the exact kernel below unchanged.
        if let Some(cut) = ctx.bool2d.as_ref() {
            if let Some(candidate) = self.try_staged_bool2d(&mesh, cut, element_id) {
                return candidate;
            }
        }

        // ANALYTIC PRISM fast path (flag-gated): each opening whose cutter is
        // a genuine stepped-extrusion prism (plain boxes AND rebated masonry
        // windows) is subtracted from the host MESH analytically — host-shape-
        // agnostic, so it fires on the faceted-BREP / clipped / multi-item
        // hosts the parametric and 2D paths above cannot serve. Tried after
        // them so their proven outputs stay byte-identical; ORIGIN-AWARE (the
        // cut runs in the host's own local frame, cutters relativized in f64,
        // `origin` re-stamped). Ineligible openings come back as a residual
        // context and are cut by the exact kernel on the analytic result — the
        // same composition contract as the 2D path (which also routes ITS
        // residual through this path on recursion, so a 2D host's perpendicular
        // sleeves take the prism cut too). Any miss falls through to the exact
        // kernel below with the FULL opening set unchanged.
        if prism_cut::enabled() && self.precision_frame.is_none() {
            // World bounds + triangle count captured BEFORE the cut so the
            // per-host diagnostic matches what the exact/rect paths record.
            let prism_bounds = world_host_bounds(&mesh);
            let prism_tris_before = mesh.triangle_count();
            if let Some((cut, residual)) = self.try_prism_cut(&mesh, ctx) {
                return match residual {
                    None => {
                        // Same per-host cut-effect snapshot the exact path
                        // records, so prism-cut hosts aren't missing from the
                        // diagnostics.
                        self.record_host_cut_effect(
                            element_id,
                            prism_tris_before,
                            cut.triangle_count(),
                            ctx.rect_opening_count(),
                            prism_bounds,
                        );
                        cut
                    }
                    // With a residual, the recursive exact pass below records
                    // the (final) cut-effect snapshot itself.
                    Some(res) => self.apply_void_context(cut, &res, element_id),
||||||| previous-upstream
        // PARAMETRIC fast path (flag-gated). ORIGIN-AWARE: it handles both the world
        // mesh (origin 0, native default) AND a per-element local-frame mesh (origin != 0,
        // the wasm default — the precision-critical case this path is FOR), since it
        // builds its own frame from the parametrics. Any miss falls through to the exact
        // kernel below unchanged.
        if crate::rect_fast::param_enabled() {
            if let Some(fast) = self.try_param_rect_cut(&mesh, ctx) {
                return fast;
            }
        }

        // 2D OPENING-SUBTRACTION fast path (flag-gated). Generalises the rect
        // parametric path above to arbitrary extruded-host profiles: subtract the
        // openings' footprints from the host's 2D profile and re-extrude. Tried
        // after `try_param_rect_cut` so proven rect+rect outputs are unchanged;
        // ORIGIN-AWARE (it builds its own world frame from the parametrics and
        // reconciles against the real host mesh, whatever `mesh.origin`). Any miss
        // falls through to the exact kernel below unchanged.
        if let Some(cut) = ctx.bool2d.as_ref() {
            if let Some(candidate) = self.try_staged_bool2d(&mesh, cut, element_id) {
                return candidate;
            }
        }

        // ANALYTIC PRISM fast path (flag-gated): each opening whose cutter is
        // a genuine stepped-extrusion prism (plain boxes AND rebated masonry
        // windows) is subtracted from the host MESH analytically — host-shape-
        // agnostic, so it fires on the faceted-BREP / clipped / multi-item
        // hosts the parametric and 2D paths above cannot serve. Tried after
        // them so their proven outputs stay byte-identical; ORIGIN-AWARE (the
        // cut runs in the host's own local frame, cutters relativized in f64,
        // `origin` re-stamped). Ineligible openings come back as a residual
        // context and are cut by the exact kernel on the analytic result — the
        // same composition contract as the 2D path (which also routes ITS
        // residual through this path on recursion, so a 2D host's perpendicular
        // sleeves take the prism cut too). Any miss falls through to the exact
        // kernel below with the FULL opening set unchanged.
        if prism_cut::enabled() {
            // World bounds + triangle count captured BEFORE the cut so the
            // per-host diagnostic matches what the exact/rect paths record.
            let prism_bounds = world_host_bounds(&mesh);
            let prism_tris_before = mesh.triangle_count();
            if let Some((cut, residual)) = self.try_prism_cut(&mesh, ctx) {
                return match residual {
                    None => {
                        // Same per-host cut-effect snapshot the exact path
                        // records, so prism-cut hosts aren't missing from the
                        // diagnostics.
                        self.record_host_cut_effect(
                            element_id,
                            prism_tris_before,
                            cut.triangle_count(),
                            ctx.rect_opening_count(),
                            prism_bounds,
                        );
                        cut
                    }
                    // With a residual, the recursive exact pass below records
                    // the (final) cut-effect snapshot itself.
                    Some(res) => self.apply_void_context(cut, &res, element_id),
=======
        // Stage A: the whole-host strategies, in the frozen order of
        // `strategy::HOST_STAGES`. The first to accept ends the cut; a residual
        // it leaves is cut by recursion on the accepted result, and that
        // recursive exact pass records the final cut-effect snapshot.
        for stage in strategy::HOST_STAGES {
            if let Some(cut) = stage.try_cut(self, &mesh, ctx, element_id) {
                return match cut.residual {
                    None => cut.mesh,
                    Some(residual) => self.apply_void_context(cut.mesh, &residual, element_id),
>>>>>>> github-main
                };
            }
        }

        // WORLD-space host AABB for the per-host diagnostic (`bbox`), captured
        // HERE — before the local-frame branch below zeroes `mesh.origin` and
        // before the wall-frame stage rotates the mesh into its own frame.
        // On the wasm/local-frame default the host is stored relative to a
        // nonzero `mesh.origin` (world = origin + position), so bounds taken
        // after the clear would be local/near-zero and misdirect
        // `diagnose-geometry --product/--type` (the #1474 local-frame-consumer
        // bug class: every world-space reader must fold `MeshData.origin`). The
        // origin is folded in f64 so georeferenced hosts report true world
        // coords, then cast to the f32 diagnostic surface.
        let host_world_bounds = world_host_bounds(&mesh);

        let origin = mesh.origin;
        if origin == [0.0, 0.0, 0.0] && ctx.all_cutters_world_framed() {
            // Legacy/world frame on host AND cutters: no relativization needed.
            return self.cut_in_frame(mesh, ctx, element_id, host_world_bounds, true);
        }
        // Work entirely in the host's local frame (origin 0 on every operand).
        // `relativized_by` folds each cutter's OWN origin and subtracts the host
        // origin in f64, so a per-element local-frame opening lands at the host
        // precisely. This also covers a host that snapped to origin 0 while its
        // openings did not (origin == 0 but cutters are local-framed).
        mesh.origin = [0.0, 0.0, 0.0];
        let local_ctx = ctx.relativized_by(origin);
        let mut result =
            self.cut_in_frame(mesh, &local_ctx, element_id, host_world_bounds, true);
        // Keep an inner local-frame cut's translation when restoring this frame.
        result.origin = std::array::from_fn(|i| result.origin[i] + origin[i]);
        result
    }


<<<<<<< custom-r7
    // `host_mutated` is set just before an early `break` (final write unread; kept
    // for readability). `allow_local_frame` (#3641) caps local-frame recursion.
    #[allow(unused_assignments, clippy::too_many_arguments)]
    fn apply_void_context_inner(
        &self,
        mesh: Mesh,
        ctx: &VoidContext,
        element_id: u32,
        host_bounds_capture: ((f32, f32, f32), (f32, f32, f32)),
        allow_local_frame: bool,
    ) -> Mesh {
        // Capture the input triangle count so the per-host diagnostic can flag
        // the "cuts attempted but produced no change" case — the silent-no-op
        // signature when an opening box doesn't intersect the host mesh. The
        // WORLD-space host AABB (`host_bounds_capture`) is passed in from
        // `apply_void_context` (captured before the origin clear / frame
        // rotation), not recomputed here from the possibly local-framed `mesh`.
        let tris_before = mesh.triangle_count();
        if ctx.is_noop() {
            return mesh;
        }
        if self.precision_frame.is_some() {
            return self.cut_authored_solids(mesh, ctx, element_id);
        }
        let original_host = mesh.clone(); // stray-shard sweep parity reference

        // LOCAL-FRAME CUT (issue #1167): a vertical wall rotated in plan is cut
        // in its own axis-aligned, origin-centred frame — where the exact
        // subtract is clean and f32-precise — then the result is rotated back.
        // The world-space tilted cut at large coordinates over-cuts and
        // fragments badly. Scoped to plan-rotated walls; everything else falls
        // through to the world path unchanged. Gated on `allow_local_frame`.
        if allow_local_frame {
            if let Some(cut) = self.try_cut_wall_local_frame(&mesh, ctx, element_id, host_bounds_capture) {
                return cut;
            }
        }

        let clipper = ClippingProcessor::new();
        // ROOT-CAUSE FIX (issue #1007, host #1112): correct f32 facet jitter on
        // the host triangle soup BEFORE the exact-kernel cut. A faceted-BREP
        // roof slope authored as ONE flat plane comes back from the f32 import
        // with adjacent facets ~0.09° non-coplanar. That jitter (a) splits the
        // slope into many one-triangle plane buckets in `consolidate_coplanar`
        // — a single-triangle bucket bypasses the CDT and is emitted as a 25:1
        // far-corner sliver fan — and (b) blocks clean coalescing of the cut
        // hole. Welding near-coplanar adjacent facets (≤0.15°, well below any
        // real roof pitch) to a single least-squares plane makes the slope
        // EXACTLY coplanar, so the cut emits one CDT-refined region (rim sliver
        // gone) with a clean opening hole. Deterministic + watertight + grid-
        // snapped; a no-op for already-planar extrusion hosts. The ordinary
        // router has already removed sub-grid SOURCE triangles before placement;
        // this whole-position-buffer weld does not replace that hygiene step or
        // promise clean output. Fresh cut candidates require path-specific
        // downstream handling (#4797).
        let mut result = crate::facet_weld::weld_near_coplanar_facets(&mesh);

        // ANALYTIC FAST PATH: an axis-aligned box host whose openings are ALL
        // axis-aligned rectangular through-cuts is subtracted analytically
        // (`rect_fast`), skipping the exact mesh-arrangement kernel — the
        // ~80 s memory-bandwidth-bound void-cut window's dominant cost. Pure
        // optimization: any precondition miss (non-box host, mixed/non-rect
        // openings, near-edge feature) returns `None` and the host falls through
        // to the exact path below unchanged. Fired BEFORE the dense-host
        // subdivision (that workaround is only for the exact kernel).
        if crate::rect_fast::enabled() {
            if let Some(fast) = self.try_rect_fast(&result, ctx) {
                // Same per-host cut-effect snapshot the exact path records below,
                // so fast-path hosts aren't missing from the diagnostics.
                self.record_host_cut_effect(
                    element_id,
                    tris_before,
                    fast.triangle_count(),
                    ctx.rect_opening_count(),
                    host_bounds_capture,
                );
                return fast;
            }
        }

        // OPENING-DENSE HOST REFINEMENT: when many openings target the same host
        // (a window wall is usually 2 big face-triangles per side), every cut's
        // intersection segments pile onto those few triangles — the exact
        // arrangement then re-triangulates a single triangle carrying dozens of
        // constraints (O(k²)), and the batched N-ary subtract leaves unrecovered
        // constraints and degrades to the O(N²) sequential path. Pre-subdividing
        // the host spreads the segments across many small triangles (small k each)
        // so the batched cut recovers. `consolidate_coplanar` re-triangulates each
        // coplanar group afterwards, so the temporary interior vertices don't
        // bloat the final mesh. Levels are scaled to opening count and capped.
        let n_openings = ctx.merged_openings.len();
        if n_openings >= 8 {
            // Just enough subdivision that each host triangle carries only a few
            // intersection segments, so the batched N-ary subtract RECOVERS rather
            // than degrading to the O(N²) sequential path — that recovery is the
            // win (≈10× on the densest walls), not the per-triangle segment count
            // itself. Over-subdividing is counter-productive: the extra triangles
            // cost more in the arrangement than the spreading saves (level 3 was
            // ~3× slower than level 1 on a 14-opening wall). Aim for ≳ a handful of
            // host triangles per opening, capped at 2 levels.
            let host_tris = result.triangle_count().max(1);
            let target = 4 * n_openings;
            let mut levels = 0usize;
            while host_tris * (1usize << (2 * (levels + 1))) < target && levels < 2 {
                levels += 1;
            }
            // A COARSE host (a box wall is ~12 triangles) still needs one split
            // even when the next level would overshoot the target; an ALREADY-dense
            // host (e.g. a faceted-BREP wall whose triangle count already meets the
            // target) is left untouched — extra geometry there only slows the cut.
            if levels == 0 && host_tris < target {
                levels = 1;
            }
            if levels > 0 {
                result = result.subdivided(levels);
            }
        }

        let (wall_min_f32, wall_max_f32) = result.bounds();
        let wall_min = Point3::new(
            wall_min_f32.x as f64,
            wall_min_f32.y as f64,
            wall_min_f32.z as f64,
        );
        let wall_max = Point3::new(
            wall_max_f32.x as f64,
            wall_max_f32.y as f64,
            wall_max_f32.z as f64,
        );

        let wall_valid = !result.is_empty()
            && result.positions.iter().all(|&v| v.is_finite())
            && result.triangle_count() >= 4;

        if !wall_valid {
            return result;
        }

        // NOTE: there is deliberately NO per-element CSG operation budget here.
        // The BSP-era `MAX_CSG_OPERATIONS = 10` cap silently skipped the 11th+
        // opening (it `continue`d past BOTH the exact subtract AND the #635 AABB
        // fallback), which is exactly the regression `csg_void_test::
        // many_tessellated_box_openings_are_all_cut` pins (history: #413/#439).
        // On the unified exact path every opening is a cheap box-vs-host cut, so
        // a budget-skipped opening is a correctness bug, not a perf guard.

        // UNIFIED EXACT PATH (PART B): every opening — axis-aligned RECTANGULAR
        // included — is now subtracted by the exact mesh kernel, NOT the legacy
        // Sutherland-Hodgman AABB clip. A `Rectangular` opening is materialised as
        // a PENETRATING box mesh (its bounds extended through the wall along the
        // extrusion axis by `extend_opening_along_direction`, so both caps poke past
        // the host ⇒ a transversal cut with no flush-cap sliver — the same robust
        // condition PART A guarantees for tilted openings). The exact subtract emits
        // the void's interior reveal faces itself, so the explicit reveal/recess
        // quad generators are no longer needed on this path.
        //
        // `synth_rect` owns the synthesised box meshes so they outlive the loop's
        // borrowed `&OpeningType`s below.
        let mut synth_rect: Vec<OpeningType> = Vec::new();
        let mut non_rect_openings: Vec<&OpeningType> = Vec::new();
        for opening in &ctx.merged_openings {
            match opening {
                OpeningType::Rectangular(open_min, open_max, extrusion_dir) => {
                    // Penetration axis: the authored extrusion dir when present,
                    // else inferred from how the box pierces the host (issue
                    // #1337). Carrying a concrete dir downstream keeps the
                    // through-host cap-flush extension off the opening's thinnest
                    // (in-plane) axis for deep cutters.
                    let dir = extrusion_dir.unwrap_or_else(|| {
                        infer_box_penetration_dir(open_min, open_max, &wall_min, &wall_max)
                    });
                    // Only openings with an AUTHORED extrusion dir were extended
                    // here before; keep the synthesized box identical for the
                    // dirless case (the inferred dir only steers the later
                    // through-host extension, not the box bounds).
                    let (final_min, final_max) = if extrusion_dir.is_some() {
                        self.extend_opening_along_direction(
                            *open_min, *open_max, wall_min, wall_max, dir,
                        )
                    } else {
                        (*open_min, *open_max)
                    };
                    let box_mesh = Self::make_box_mesh(final_min, final_max);
                    synth_rect.push(OpeningType::NonRectangular(
                        box_mesh,
                        final_min,
                        final_max,
                        Some(dir),
                    ));
                }
                // A MALFORMED (self-intersecting) tessellated cutter is NOT cut
                // here: its messy mesh under-cuts the opening, and double-cutting
                // it (here AND in the clean-box `recut_malformed_openings` pass)
                // leaves overlapping sliver "shards" in the reveals. Skip it; the
                // recut performs the single, clean box cut for these openings.
                OpeningType::NonRectangular(m, ..) if opening_obb_if_malformed(m).is_some() => {}
                other => non_rect_openings.push(other),
            }
        }
        let all_openings: Vec<&OpeningType> =
            synth_rect.iter().chain(non_rect_openings.iter().copied()).collect();

        // DISJOINT-CUTTER BATCHING: group cutters whose pad-inflated AABBs are
        // pairwise disjoint and subtract each group in ONE conforming arrangement
        // (`ClippingProcessor::subtract_mesh_many`). Sequential per-opening
        // subtraction re-arranges the (growing) host once per cutter, and each
        // intermediate f64→f32→snap round-trip re-jitters carve vertices off
        // shared planes so cut N+1 re-cracks what cut N reconciled (many-void
        // walls' compounding open edges, the 16-void slab's ~3.5 s cost). Batching
        // admits only openings passing the SAME guards as the sequential loop plus
        // per-component watertightness (#2176). Singletons and any group whose
        // batched cut fails its guards — or the kernel conformity gate
        // (`subtract_mesh_many` rejects a group whose N-ary arrangement left an
        // unrecovered constraint) — fall through to the per-opening sequential
        // loop below with its full #635 fallback / engulf / redundant-void machinery.
        let mut batch_consumed: Vec<bool> = vec![false; all_openings.len()];
        // Disjoint groups of opening indices (len ≥ 2 only); each is cut
        // INLINE at its first member's position in the sequential loop below,
        // so the relative order of batched vs sequential cutters matches the
        // pure sequential pass — only the order WITHIN a group (mutually
        // disjoint cutters, the provably order-free case) is collapsed.
        let mut batch_groups: Vec<Vec<(usize, Mesh)>> = Vec::new();
        let mut batch_group_of: FxHashMap<usize, usize> = FxHashMap::default();
        // Set on every successful cut; while false, a group's admission-time
        // extended cutters are still valid and reused verbatim.
        let mut host_mutated = false;

        // COAXIAL FOOTPRINT-UNION for OVERLAPPING clusters (issue #129, flag
        // `IFC_LITE_VOID_UNION`). Overlapping cutters can't join the disjoint batch
        // below and otherwise fall to the O(N) sequential exact path; this fuses
        // each overlapping coaxial cluster into disjoint re-extruded prisms and cuts
        // them in one `subtract_mesh_many`. See `coaxial_union`. Marks consumed
        // openings so the batch + sequential loops skip them; a cluster that fails
        // any guard is left unconsumed for the exact path (never worse than exact).
        self.coaxial_union_prepass(
            &mut result,
            &all_openings,
            &mut batch_consumed,
            &mut host_mutated,
            &clipper,
        );

        if all_openings.len() >= 2 {
            // Inflation pad: ≥ 2×(promote band 8·2⁻¹⁶ ≈ 122 µm + snap radius);
            // 1 mm is conservative and far below any real opening separation.
            // Touching/overlapping cutters land in DIFFERENT groups, cut in
            // sequence — overlap degrades gracefully to sequential behavior.
            const BATCH_PAD: f64 = disjoint_groups::PAD;
            struct Cand {
                idx: usize,
                /// The admission-time extended cutter (host PRE-cut). Reused at
                /// cut time while the host is still unmutated — the common case
                /// (groups are cut at their FIRST member, usually before any
                /// sequential cut) — so extension isn't paid twice.
                mesh: Mesh,
                lo: [f64; 3],
                hi: [f64; 3],
            }
            let mut cands: Vec<Cand> = Vec::new();
            for (idx, opening) in all_openings.iter().enumerate() {
                // Already cut by the coaxial/overlap-union prepass above.
                if batch_consumed[idx] {
                    continue;
                }
                let Some((opening_mesh, extrusion_dir)) = opening.mesh_cutter() else { continue };
                // Same admission guards as the sequential loop.
                let opening_valid = !opening_mesh.is_empty()
                    && opening_mesh.positions.iter().all(|&v| v.is_finite())
                    && opening_mesh.positions.len() >= 9;
                if !opening_valid {
                    continue;
                }
                let (result_min, result_max) = result.bounds();
                let (omn, omx) = opening_mesh.bounds();
                let no_overlap = omx.x < result_min.x
                    || omn.x > result_max.x
                    || omx.y < result_min.y
                    || omn.y > result_max.y
                    || omx.z < result_min.z
                    || omn.z > result_max.z;
                if no_overlap {
                    continue;
                }
                let open_vol = (omx.x - omn.x) as f64
                    * (omx.y - omn.y) as f64
                    * (omx.z - omn.z) as f64;
                if open_vol < Self::min_opening_volume(self.tessellation_quality) {
                    continue;
                }
                let Some(ext) = Self::batch_cutter(opening_mesh, extrusion_dir, &result) else {
                    continue;
                };
                let (lo, hi) = ext.bounds();
                // Engulf-class exclusion: a cutter whose extended AABB covers
                // the whole host on EVERY axis (3% slack, the sequential
                // engulf test) stays on the sequential path, where the
                // near-engulf and redundant-void guards live — batched it can
                // shave the host's outer shell (the #559171-family residual).
                let engulfs = {
                    let tol = ENGULF_TOLERANCE;
                    let covers = |omin: f64, omax: f64, wmin: f64, wmax: f64| {
                        let slack = (wmax - wmin).abs().max(1.0e-9) * tol;
                        omin <= wmin + slack && omax >= wmax - slack
                    };
                    covers(lo.x as f64, hi.x as f64, wall_min.x, wall_max.x)
                        && covers(lo.y as f64, hi.y as f64, wall_min.y, wall_max.y)
                        && covers(lo.z as f64, hi.z as f64, wall_min.z, wall_max.z)
                };
                if engulfs {
                    continue;
                }
                cands.push(Cand {
                    idx,
                    mesh: ext,
                    lo: [
                        lo.x as f64 - BATCH_PAD,
                        lo.y as f64 - BATCH_PAD,
                        lo.z as f64 - BATCH_PAD,
                    ],
                    hi: [
                        hi.x as f64 + BATCH_PAD,
                        hi.y as f64 + BATCH_PAD,
                        hi.z as f64 + BATCH_PAD,
                    ],
                });
            }
            // Greedy disjoint grouping, deterministic in opening order: a
            // candidate joins the first group whose EVERY member's inflated
            // AABB is disjoint from its own.
            let bounds=cands.iter().map(|candidate|(candidate.lo,candidate.hi)).collect::<Vec<_>>();
            let groups=disjoint_groups::partition(&bounds);
            for g in &groups {
                if g.len() < 2 {
                    continue; // singleton: sequential loop handles it (full guards)
                }
                let gid = batch_groups.len();
                for &ci in g {
                    batch_group_of.insert(cands[ci].idx, gid);
                }
                batch_groups
                    .push(g.iter().map(|&ci| (cands[ci].idx, cands[ci].mesh.clone())).collect());
            }
        }

        for (opening_idx, opening) in all_openings.iter().enumerate() {
            if batch_consumed[opening_idx] {
                continue; // already handled by a batched disjoint group
            }
            // Batched group cut, attempted ONCE, inline at the group's first
            // member — so the relative order of batched vs sequential cutters
            // matches the pure sequential pass. On any failure (admission,
            // guards, or the kernel's conformity gate) the members fall back
            // to the per-opening sequential path below.
            if let Some(&gid) = batch_group_of.get(&opening_idx) {
                let members = std::mem::take(&mut batch_groups[gid]);
                if members.len() >= 2 {
                    // While the host is unmutated, the admission-time extended
                    // cutters (built against this exact host) are reused as-is;
                    // after any cut, members are re-extended against the
                    // CURRENT host — matching the sequential loop's reference,
                    // which extends each cutter against the (k−1)-cut host.
                    let mut extended: Vec<(usize, Mesh)> = Vec::with_capacity(members.len());
                    let mut admissible = true;
                    if !host_mutated {
                        extended = members;
                    } else {
                        for &(m_idx, _) in &members {
                            let ext = all_openings[m_idx]
                                .mesh_cutter()
                                .and_then(|(m, dir)| Self::batch_cutter(m, dir, &result));
                            let Some(ext) = ext else {
                                admissible = false;
                                break;
                            };
                            extended.push((m_idx, ext));
                        }
                    }
                    if admissible {
                        let cutters: Vec<&Mesh> = extended.iter().map(|(_, m)| m).collect();
                        let tri_before = result.triangle_count();
                        let outcome = if Self::batch_cutters_match_sequential(&result, &all_openings, &extended) {
                            clipper.subtract_mesh_many_retaining_miss(&result, &cutters)
                        } else {
                            clipper.subtract_mesh_many(&result, &cutters)
                        };
                        // #6516: retain the group's validated consolidation on
                        // a conforming miss; keeping the original host instead
                        // can discard useful seam repairs made by the singles.
                        if let GroupCut::Cut(csg_result) | GroupCut::Retessellated(csg_result) = outcome {
                            let min_tris = (tri_before / CSG_TRIANGLE_RETENTION_DIVISOR)
                                .max(MIN_VALID_TRIANGLES);
                            if !csg_result.is_empty() && csg_result.triangle_count() >= min_tris {
                                result = csg_result;
                                host_mutated = true;
                                for &(m_idx, _) in &extended {
                                    batch_consumed[m_idx] = true;
                                }
                            }
                        }
                    }
                }
                if batch_consumed[opening_idx] {
                    continue; // this opening was handled with its group
                }
            }
            // Normalize both exact-subtract variants into the same (mesh, min,
            // max, dir) shape. `DiagonalRectangular` (a clean but tilted box —
            // e.g. a roof-slope window or a slanted roof opening, #1007 defect B)
            // is a REAL solid cutter, so it MUST be subtracted exactly, never
            // approximated by a frame-rotated AABB: that legacy path
            // (`apply_diagonal_openings`) tore the host (101 boundary edges) and
            // left the void uncut. Route it through the same exact-mesh subtract
            // as `NonRectangular`; the kernel cuts the tilted box cleanly
            // (winding-robust after the defect-A orient-outward fix). The
            // mesh-bounds AABB + frame-depth direction still seed the #635
            // fallback, which only fires if the exact subtract no-ops.
            let normalized: Option<(&Mesh, Point3<f64>, Point3<f64>, Option<Vector3<f64>>)> =
                match *opening {
                    OpeningType::Rectangular(..) => None,
                    OpeningType::DiagonalRectangular(ref opening_mesh, ref frame) => {
                        let (mn, mx) = opening_mesh.bounds();
                        Some((
                            opening_mesh,
                            Point3::new(mn.x as f64, mn.y as f64, mn.z as f64),
                            Point3::new(mx.x as f64, mx.y as f64, mx.z as f64),
                            Some(frame.depth),
                        ))
                    }
                    OpeningType::NonRectangular(
                        ref opening_mesh,
                        ref open_min_pt,
                        ref open_max_pt,
                        ref extrusion_dir,
                    ) => Some((opening_mesh, *open_min_pt, *open_max_pt, *extrusion_dir)),
                };
            if let Some((opening_mesh, open_min_pt, open_max_pt, extrusion_dir)) = normalized {
                let open_min_pt = &open_min_pt;
                let open_max_pt = &open_max_pt;
                {
                    let opening_valid = !opening_mesh.is_empty()
                        && opening_mesh.positions.iter().all(|&v| v.is_finite())
                        && opening_mesh.positions.len() >= 9;

                    if !opening_valid {
                        continue;
                    }

                    let (result_min, result_max) = result.bounds();
                    let (open_min_f32, open_max_f32) = opening_mesh.bounds();
                    let no_overlap = open_max_f32.x < result_min.x
                        || open_min_f32.x > result_max.x
                        || open_max_f32.y < result_min.y
                        || open_min_f32.y > result_max.y
                        || open_max_f32.z < result_min.z
                        || open_min_f32.z > result_max.z;
                    if no_overlap {
                        continue;
                    }

                    let open_vol = (open_max_f32.x - open_min_f32.x)
                        * (open_max_f32.y - open_min_f32.y)
                        * (open_max_f32.z - open_min_f32.z);
                    // The 0.1 L volume floor filtered legacy-BSP CSG artefacts but
                    // also drops genuine small openings — bolt holes / sleeves in
                    // thin plates. At the two highest quality levels keep those
                    // holes (the exact kernel is stable on small cutters); only
                    // reject numerically degenerate cutters there. (issue #976)
                    let min_open_vol = Self::min_opening_volume(self.tessellation_quality) as f32;
                    if open_vol < min_open_vol {
                        continue;
                    }

                    // ENGULFING-SOLID VOID: when this opening's real solid
                    // CONTAINS the whole host, the exact subtract no-ops on the
                    // coincident shared faces and returns the host unchanged in
                    // volume (a spurious solid where the opening should be). A
                    // cheap AABB-engulf pre-check (false for an ordinary opening,
                    // which spans the host on at most its thickness axis) gates
                    // the O(host_v · opening_t) containment scan, which confirms
                    // TRUE solid containment — so a void whose AABB engulfs the
                    // host while its real profile excludes it is not affected.
                    // On a hit the host is fully consumed.
                    let aabb_engulfs = {
                        let tol = ENGULF_TOLERANCE_F32;
                        let covers = |omin: f32, omax: f32, hmin: f32, hmax: f32| {
                            let slack = (hmax - hmin).abs().max(1.0e-9) * tol;
                            omin <= hmin + slack && omax >= hmax - slack
                        };
                        covers(open_min_f32.x, open_max_f32.x, result_min.x, result_max.x)
                            && covers(open_min_f32.y, open_max_f32.y, result_min.y, result_max.y)
                            && covers(open_min_f32.z, open_max_f32.z, result_min.z, result_max.z)
                    };
                    if aabb_engulfs && opening_engulfs_host_solid(&result, opening_mesh) {
                        // Mark the host consumed so the element pipeline keeps
                        // the empty result instead of falling back to the un-cut
                        // host.
                        self.record_void_consumed_host(element_id);
                        result = Mesh::default();
                        host_mutated = true;
                        break;
                    }

                    let tri_before = result.triangle_count();
                    let failures_before = clipper.failure_count();
                    let mut csg_succeeded = false;
                    // PENETRATING CUTTER (PART A): push the opening's caps a hair
                    // PAST the host along its depth axis so a flush cap becomes a
                    // clean transversal crossing — the exact kernel then cuts the
                    // tilted, faceted roof opening with no bridging sliver (#1007
                    // host #1112). Falls back to the raw opening mesh when no depth
                    // direction is known (the kernel handles a true through-cutter
                    // anyway; the extension only matters for the flush-cap case).
                    let extended_opening = Self::sequential_cutter(
                        opening_mesh, extrusion_dir, &result,
                    );
                    let cutter = &extended_opening;
                    let outcome = clipper.subtract_mesh(&result, cutter);
                    // Nothing to cut, so the #635 fallback below must not cut a
                    // box either (#5362).
                    let kernel_found_no_overlap = outcome.found_no_overlap();
                    let kept = mesh_to_keep(outcome, &result);
                    // The host is still un-cut: the kernel found no real
                    // intersection, or bailed on a grazing/coplanar cutter.
                    let csg_unchanged = kept.is_none();
                    if let Some(csg_result) = kept {
                        let min_tris = (tri_before / CSG_TRIANGLE_RETENTION_DIVISOR)
                            .max(MIN_VALID_TRIANGLES);
                        if !csg_result.is_empty() && csg_result.triangle_count() >= min_tris {
                            result = csg_result;
                            host_mutated = true;
                            csg_succeeded = true;
                        }
                    }

                    // AABB fallback (issue #635): when CSG can't subtract the
                    // opening (most commonly because its triangulated profile
                    // exceeds `MAX_CSG_POLYGONS_PER_MESH`, i.e. circular /
                    // arched / arbitrary curved openings), cut the opening's
                    // axis-aligned bounding box instead. This leaves a square
                    // hole in place of a round one, but a square hole is
                    // dramatically less wrong than a missing void on a wall
                    // that is supposed to host a window or door.
                    // A re-tessellation this router refused on its own
                    // retention check is not a verdict: fall back as before.
                    let kernel_verdict_disjoint = kernel_found_no_overlap && csg_unchanged;
                    if !csg_succeeded && !kernel_verdict_disjoint {
                        let dir = extrusion_dir.or_else(|| {
                            Some(wall_thinnest_axis_dir(&wall_min, &wall_max))
                        });
                        let (final_min, final_max) = if let Some(dir) = dir {
                            self.extend_opening_along_direction(
                                *open_min_pt,
                                *open_max_pt,
                                wall_min,
                                wall_max,
                                dir,
                            )
                        } else {
                            (*open_min_pt, *open_max_pt)
                        };
                        // Near-engulf guard. When CSG returned the host *unchanged*
                        // (no cut) AND the opening's AABB covers the whole wall on
                        // every axis, the rectangular fallback would cut that
                        // engulfing box and delete the wall. This is the signature
                        // of a non-rectangular opening whose bounding box engulfs
                        // the host while its real profile excludes it: the kernel
                        // errors on the grazing/coplanar cutter and returns the
                        // un-cut host, which is already the correct result vs
                        // IfcOpenShell (advanced #555433's facade-scale void
                        // #555493). Keep the un-cut host instead of over-cutting.
                        // Normal windows/doors — including the issue-635 high-poly
                        // round openings the AABB box approximates — sit INSIDE the
                        // wall and never engulf it, so they still take the fallback.
                        // The 3% per-axis tolerance absorbs an opening that reaches
                        // ~flush with a wall face (its near plane).
                        let engulfs_host = {
                            let tol = ENGULF_TOLERANCE;
                            let covers = |omin: f64, omax: f64, wmin: f64, wmax: f64| {
                                let slack = (wmax - wmin).abs().max(1.0e-9) * tol;
                                omin <= wmin + slack && omax >= wmax - slack
                            };
                            covers(final_min.x, final_max.x, wall_min.x, wall_max.x)
                                && covers(final_min.y, final_max.y, wall_min.y, wall_max.y)
                                && covers(final_min.z, final_max.z, wall_min.z, wall_max.z)
                        };
                        // `capped` keys on the `OperandTooLarge` rejection: the
                        // #1109 per-boolean/-element escalation budget records it
                        // when a cut trips mid-arrangement and bails to the un-cut
                        // host (`csg/mod.rs`), so it is NOT always false — a
                        // grazing engulfing cutter that would run long trips the
                        // budget just as it errors on the coincident faces.
                        // Engulf suppression therefore applies regardless of WHY
                        // the CSG produced no change (budget trip or kernel error
                        // on the coincident faces): an engulfing cutter's AABB
                        // covers the whole host, so the #635 box-cut would delete
                        // the entire wall — a silent element deletion strictly
                        // worse than leaving a phantom (un-cut) solid. `capped` is
                        // now only read by the diagnostic below (it no longer
                        // gates the suppression), so it is unused in a release
                        // build that compiles out both the tracing and the
                        // debug/test `eprintln!` legs of `diag_warn!`.
                        #[allow(unused_variables)]
                        let capped = clipper.has_operand_too_large_since(failures_before);
                        // Issue #964: suppress the destructive AABB box when the
                        // host already has this void cut into it (a void
                        // double-encoded as both a profile inner curve and a
                        // redundant IfcOpeningElement). When every column through
                        // the opening footprint is already open in the host,
                        // cutting the bounding box would replace a correct
                        // round/polygonal hole with a rectangle. Unlike the
                        // engulf heuristic this is a positive void detection, so
                        // it overrides `capped` too (the void demonstrably
                        // exists — there is nothing left to approximate).
                        let probe_axis = dir.unwrap_or_else(|| {
                            wall_thinnest_axis_dir(&wall_min, &wall_max)
                        });
                        let redundant_void =
                            opening_redundant_with_host(&result, opening_mesh, &probe_axis);
                        let suppress_fallback =
                            redundant_void || (csg_unchanged && engulfs_host);
                        if !suppress_fallback {
                            // Diagnostic for issue #635: log the opening
                            // triangle count when the AABB fallback actually
                            // fires, so round windows (post profile
                            // simplification) can be confirmed to hit CSG and
                            // only genuinely-uncut voids land on the box cut.
                            // A genuine degraded mode, so warn-level under
                            // observability; the legacy debug/test-only
                            // eprintln is preserved otherwise.
                            crate::diag::diag_warn!(
                                { opening_tris = opening_mesh.triangle_count(),
                                  reason = "csg-produced-no-change",
                                  "voids: AABB fallback cut used for opening" }
                                else {
                                    #[cfg(any(debug_assertions, test))]
                                    eprintln!(
                                        "[issue-635] AABB fallback used: opening={} tris (CSG produced no change)",
                                        opening_mesh.triangle_count()
                                    );
                                }
                            );
                            // Deliberate degraded mode: this fallback removes
                            // the wall material inside the opening AABB but no
                            // longer emits reveal/recess quads (deleted with
                            // the legacy clip path), so its output has an open
                            // rim. It runs only when the kernel FAILED on an
                            // opening that reaches the host, never on one the
                            // kernel found disjoint (#5362).
                            let aabb_cut =
                                self.cut_rectangular_opening(&result, final_min, final_max);
                            #[cfg(feature = "opening-perf-trace")]
                            crate::opening_perf_trace::record(|c| {
                                c.aabb_fallback_attempts = c.aabb_fallback_attempts.saturating_add(1);
                                c.aabb_fallback_input_triangles = c.aabb_fallback_input_triangles.saturating_add(result.triangle_count() as u64);
                                c.aabb_fallback_output_triangles = c.aabb_fallback_output_triangles.saturating_add(aabb_cut.triangle_count() as u64);
                            });
                            if !aabb_cut.is_empty() && aabb_cut.triangle_count() != tri_before {
                                #[cfg(feature = "opening-perf-trace")]
                                crate::opening_perf_trace::record(|c| c.aabb_fallback_commits = c.aabb_fallback_commits.saturating_add(1));
                                result = aabb_cut;
                                host_mutated = true;
                            }
                        } else {
                            // The engulfing/redundant-void guard suppressed the
                            // #635 AABB box-cut. For an engulfing cutter the box
                            // covers the whole host, so cutting it would DELETE
                            // the wall; leaving the host un-cut (a phantom solid)
                            // is the strictly safer degrade. `capped` records
                            // whether the CSG bailed via the #1109 budget trip
                            // (`OperandTooLarge`) vs a kernel error on the
                            // coincident faces.
                            crate::diag::diag_warn!(
                                { opening_tris = opening_mesh.triangle_count(),
                                  capped = capped,
                                  reason = "engulfing-cutter-fallback-suppressed",
                                  "voids: AABB fallback suppressed for engulfing cutter (host left un-cut)" }
                                else {
                                    #[cfg(any(debug_assertions, test))]
                                    eprintln!(
                                        "[issue-635] AABB fallback SUPPRESSED for engulfing cutter: opening={} tris, capped={} (host left un-cut)",
                                        opening_mesh.triangle_count(),
                                        capped
                                    );
                                }
                            );
                        }
                    }
                }
            }
        }

        // NOTE (issue #635): the clipping planes from `IfcBooleanClippingResult`
        // are already applied by `BooleanClippingProcessor::process` during
        // `process_element` — the post-clip mesh is the *input* to this
        // function. Re-clipping here was a leftover from before that
        // processor existed; for `IfcPolygonalBoundedHalfSpace` it actively
        // *broke* gable walls, because `extract_half_space_plane` discards
        // the polygonal bound and the resulting unbounded plane chops off
        // the gable peak. Voids alone are applied here.

        // Drain whatever fallbacks the kernel logged during this element's
        // void / clip pass, attribute them to the host product, and stash on
        // the router so the caller can surface them (e.g. flagged in a
        // viewer overlay or asserted in regression tests).
        let kernel_failures = clipper.take_failures();
        if !kernel_failures.is_empty() {
            self.record_host_failure_summary(element_id, &kernel_failures);
            self.record_csg_failures(element_id, kernel_failures);
        }

        // WATERTIGHT SLIVER REFINEMENT (issue #1007): the exact-kernel cut of a
        // long, tilted faceted-BREP host facet can emit a high-aspect corner
        // sliver (a far-corner triangle fanned to two new rim vertices a few cm
        // apart) that lands ALONE in its plane bucket and so bypasses the
        // coplanar CDT. Bisect any >8:1 triangle's longest edge at its midpoint,
        // splitting BOTH incident triangles in lockstep so the mesh stays
        // watertight (no T-junction) and the midpoint lies ON the original edge
        // ⇒ cut volume is preserved exactly. A no-op on clean cuts (no triangle
        // exceeds 8:1), so it does not perturb the frozen corpus. Only runs when
        // a cut was actually attempted (`!ctx.is_noop()` guarantees this path).
        // This canonicalizer is likewise not a hygiene boundary: fresh sub-grid
        // candidates require handling by the remaining repair/clip/sweep path,
        // independently of the router's earlier source cleanup (#4797).
        let mut result = crate::facet_weld::refine_high_aspect_slivers(&result);

        // UNDER-CUT REPAIR: a self-intersecting tessellated cutter (garbage
        // vertices metres from the real opening) makes the kernel UNDER-cut — a
        // wall flap bridges the opening. Re-cut each such opening with a clean
        // box (removes only the opening prism, taking the flap, while preserving
        // and re-triangulating the wall around the hole). Done HERE, in the cut
        // frame (host + cutters share it), and BEFORE the spike clip so any
        // residual protrusion is still caught. A no-op when no cutter is
        // malformed — clean openings are never reshaped.
        recut_malformed_openings(&mut result, &ctx.malformed_opening_boxes());

        // SPURIOUS-FLAP CLIP: a subtract can only remove material, so the cut is
        // mathematically contained in the host's pre-cut AABB (`wall_min/max`);
        // any triangle poking past it is provably an artifact — a malformed
        // cutter's far-flung leaked flap (self-intersecting / tessellated void,
        // surfacing once a SECOND cutter perturbs the arrangement), OR the
        // flush-cap through-extension reveal overhang (`extend_opening_mesh_
        // through_host` pushes a flush cap ~0.3·depth past the host for a clean
        // transversal cut, so the subtract emits the reveal out to it — 0.105 m
        // past a 0.35 m floor slab, #1633). `clip_triangles_to_host_aabb` bounds
        // its jitter tolerance so a large host cannot leak the overhang. A no-op
        // on clean cuts.
        result.clip_triangles_to_host_aabb(
            [wall_min.x as f32, wall_min.y as f32, wall_min.z as f32],
            [wall_max.x as f32, wall_max.y as f32, wall_max.z as f32],
        );

        // STRAY-SHARD SWEEP: see `sweep::drop_faces_outside_host` (#1788).
        if host_mutated {
            result = drop_faces_outside_host(result, &original_host);
        }

        // Per-host cut-effect snapshot: tris_before / tris_after lets the
        // diagnostic surface the silent-no-op case (rectangular boxes
        // processed but the host mesh came out unchanged — the box
        // probably didn't intersect the wall, e.g. wrong placement).
        self.record_host_cut_effect(
            element_id,
            tris_before,
            result.triangle_count(),
            ctx.rect_opening_count(),
            host_bounds_capture,
        );

        result
    }
||||||| previous-upstream
    // `host_mutated` is set just before an early `break` (final write unread; kept
    // for readability). `allow_local_frame` (#3641) caps local-frame recursion.
    #[allow(unused_assignments, clippy::too_many_arguments)]
    fn apply_void_context_inner(
        &self,
        mesh: Mesh,
        ctx: &VoidContext,
        element_id: u32,
        host_bounds_capture: ((f32, f32, f32), (f32, f32, f32)),
        allow_local_frame: bool,
    ) -> Mesh {
        // Capture the input triangle count so the per-host diagnostic can flag
        // the "cuts attempted but produced no change" case — the silent-no-op
        // signature when an opening box doesn't intersect the host mesh. The
        // WORLD-space host AABB (`host_bounds_capture`) is passed in from
        // `apply_void_context` (captured before the origin clear / frame
        // rotation), not recomputed here from the possibly local-framed `mesh`.
        let tris_before = mesh.triangle_count();
        if ctx.is_noop() {
            return mesh;
        }
        let original_host = mesh.clone(); // stray-shard sweep parity reference

        // LOCAL-FRAME CUT (issue #1167): a vertical wall rotated in plan is cut
        // in its own axis-aligned, origin-centred frame — where the exact
        // subtract is clean and f32-precise — then the result is rotated back.
        // The world-space tilted cut at large coordinates over-cuts and
        // fragments badly. Scoped to plan-rotated walls; everything else falls
        // through to the world path unchanged. Gated on `allow_local_frame`.
        if allow_local_frame {
            if let Some(cut) = self.try_cut_wall_local_frame(&mesh, ctx, element_id, host_bounds_capture) {
                return cut;
            }
        }

        let clipper = ClippingProcessor::new();
        // ROOT-CAUSE FIX (issue #1007, host #1112): correct f32 facet jitter on
        // the host triangle soup BEFORE the exact-kernel cut. A faceted-BREP
        // roof slope authored as ONE flat plane comes back from the f32 import
        // with adjacent facets ~0.09° non-coplanar. That jitter (a) splits the
        // slope into many one-triangle plane buckets in `consolidate_coplanar`
        // — a single-triangle bucket bypasses the CDT and is emitted as a 25:1
        // far-corner sliver fan — and (b) blocks clean coalescing of the cut
        // hole. Welding near-coplanar adjacent facets (≤0.15°, well below any
        // real roof pitch) to a single least-squares plane makes the slope
        // EXACTLY coplanar, so the cut emits one CDT-refined region (rim sliver
        // gone) with a clean opening hole. Deterministic + watertight + grid-
        // snapped; a no-op for already-planar extrusion hosts. The ordinary
        // router has already removed sub-grid SOURCE triangles before placement;
        // this whole-position-buffer weld does not replace that hygiene step or
        // promise clean output. Fresh cut candidates require path-specific
        // downstream handling (#4797).
        let mut result = crate::facet_weld::weld_near_coplanar_facets(&mesh);

        // ANALYTIC FAST PATH: an axis-aligned box host whose openings are ALL
        // axis-aligned rectangular through-cuts is subtracted analytically
        // (`rect_fast`), skipping the exact mesh-arrangement kernel — the
        // ~80 s memory-bandwidth-bound void-cut window's dominant cost. Pure
        // optimization: any precondition miss (non-box host, mixed/non-rect
        // openings, near-edge feature) returns `None` and the host falls through
        // to the exact path below unchanged. Fired BEFORE the dense-host
        // subdivision (that workaround is only for the exact kernel).
        if crate::rect_fast::enabled() {
            if let Some(fast) = self.try_rect_fast(&result, ctx) {
                // Same per-host cut-effect snapshot the exact path records below,
                // so fast-path hosts aren't missing from the diagnostics.
                self.record_host_cut_effect(
                    element_id,
                    tris_before,
                    fast.triangle_count(),
                    ctx.rect_opening_count(),
                    host_bounds_capture,
                );
                return fast;
            }
        }

        // OPENING-DENSE HOST REFINEMENT: when many openings target the same host
        // (a window wall is usually 2 big face-triangles per side), every cut's
        // intersection segments pile onto those few triangles — the exact
        // arrangement then re-triangulates a single triangle carrying dozens of
        // constraints (O(k²)), and the batched N-ary subtract leaves unrecovered
        // constraints and degrades to the O(N²) sequential path. Pre-subdividing
        // the host spreads the segments across many small triangles (small k each)
        // so the batched cut recovers. `consolidate_coplanar` re-triangulates each
        // coplanar group afterwards, so the temporary interior vertices don't
        // bloat the final mesh. Levels are scaled to opening count and capped.
        let n_openings = ctx.merged_openings.len();
        if n_openings >= 8 {
            // Just enough subdivision that each host triangle carries only a few
            // intersection segments, so the batched N-ary subtract RECOVERS rather
            // than degrading to the O(N²) sequential path — that recovery is the
            // win (≈10× on the densest walls), not the per-triangle segment count
            // itself. Over-subdividing is counter-productive: the extra triangles
            // cost more in the arrangement than the spreading saves (level 3 was
            // ~3× slower than level 1 on a 14-opening wall). Aim for ≳ a handful of
            // host triangles per opening, capped at 2 levels.
            let host_tris = result.triangle_count().max(1);
            let target = 4 * n_openings;
            let mut levels = 0usize;
            while host_tris * (1usize << (2 * (levels + 1))) < target && levels < 2 {
                levels += 1;
            }
            // A COARSE host (a box wall is ~12 triangles) still needs one split
            // even when the next level would overshoot the target; an ALREADY-dense
            // host (e.g. a faceted-BREP wall whose triangle count already meets the
            // target) is left untouched — extra geometry there only slows the cut.
            if levels == 0 && host_tris < target {
                levels = 1;
            }
            if levels > 0 {
                result = result.subdivided(levels);
            }
        }

        let (wall_min_f32, wall_max_f32) = result.bounds();
        let wall_min = Point3::new(
            wall_min_f32.x as f64,
            wall_min_f32.y as f64,
            wall_min_f32.z as f64,
        );
        let wall_max = Point3::new(
            wall_max_f32.x as f64,
            wall_max_f32.y as f64,
            wall_max_f32.z as f64,
        );

        let wall_valid = !result.is_empty()
            && result.positions.iter().all(|&v| v.is_finite())
            && result.triangle_count() >= 4;

        if !wall_valid {
            return result;
        }

        // NOTE: there is deliberately NO per-element CSG operation budget here.
        // The BSP-era `MAX_CSG_OPERATIONS = 10` cap silently skipped the 11th+
        // opening (it `continue`d past BOTH the exact subtract AND the #635 AABB
        // fallback), which is exactly the regression `csg_void_test::
        // many_tessellated_box_openings_are_all_cut` pins (history: #413/#439).
        // On the unified exact path every opening is a cheap box-vs-host cut, so
        // a budget-skipped opening is a correctness bug, not a perf guard.

        // UNIFIED EXACT PATH (PART B): every opening — axis-aligned RECTANGULAR
        // included — is now subtracted by the exact mesh kernel, NOT the legacy
        // Sutherland-Hodgman AABB clip. A `Rectangular` opening is materialised as
        // a PENETRATING box mesh (its bounds extended through the wall along the
        // extrusion axis by `extend_opening_along_direction`, so both caps poke past
        // the host ⇒ a transversal cut with no flush-cap sliver — the same robust
        // condition PART A guarantees for tilted openings). The exact subtract emits
        // the void's interior reveal faces itself, so the explicit reveal/recess
        // quad generators are no longer needed on this path.
        //
        // `synth_rect` owns the synthesised box meshes so they outlive the loop's
        // borrowed `&OpeningType`s below.
        let mut synth_rect: Vec<OpeningType> = Vec::new();
        let mut non_rect_openings: Vec<&OpeningType> = Vec::new();
        for opening in &ctx.merged_openings {
            match opening {
                OpeningType::Rectangular(open_min, open_max, extrusion_dir) => {
                    // Penetration axis: the authored extrusion dir when present,
                    // else inferred from how the box pierces the host (issue
                    // #1337). Carrying a concrete dir downstream keeps the
                    // through-host cap-flush extension off the opening's thinnest
                    // (in-plane) axis for deep cutters.
                    let dir = extrusion_dir.unwrap_or_else(|| {
                        infer_box_penetration_dir(open_min, open_max, &wall_min, &wall_max)
                    });
                    // Only openings with an AUTHORED extrusion dir were extended
                    // here before; keep the synthesized box identical for the
                    // dirless case (the inferred dir only steers the later
                    // through-host extension, not the box bounds).
                    let (final_min, final_max) = if extrusion_dir.is_some() {
                        self.extend_opening_along_direction(
                            *open_min, *open_max, wall_min, wall_max, dir,
                        )
                    } else {
                        (*open_min, *open_max)
                    };
                    let box_mesh = Self::make_box_mesh(final_min, final_max);
                    synth_rect.push(OpeningType::NonRectangular(
                        box_mesh,
                        final_min,
                        final_max,
                        Some(dir),
                    ));
                }
                // A MALFORMED (self-intersecting) tessellated cutter is NOT cut
                // here: its messy mesh under-cuts the opening, and double-cutting
                // it (here AND in the clean-box `recut_malformed_openings` pass)
                // leaves overlapping sliver "shards" in the reveals. Skip it; the
                // recut performs the single, clean box cut for these openings.
                OpeningType::NonRectangular(m, ..) if opening_obb_if_malformed(m).is_some() => {}
                other => non_rect_openings.push(other),
            }
        }
        let all_openings: Vec<&OpeningType> =
            synth_rect.iter().chain(non_rect_openings.iter().copied()).collect();

        // DISJOINT-CUTTER BATCHING: group cutters whose pad-inflated AABBs are
        // pairwise disjoint and subtract each group in ONE conforming arrangement
        // (`ClippingProcessor::subtract_mesh_many`). Sequential per-opening
        // subtraction re-arranges the (growing) host once per cutter, and each
        // intermediate f64→f32→snap round-trip re-jitters carve vertices off
        // shared planes so cut N+1 re-cracks what cut N reconciled (many-void
        // walls' compounding open edges, the 16-void slab's ~3.5 s cost). Batching
        // admits only openings passing the SAME guards as the sequential loop plus
        // per-component watertightness (#2176). Singletons and any group whose
        // batched cut fails its guards — or the kernel conformity gate
        // (`subtract_mesh_many` rejects a group whose N-ary arrangement left an
        // unrecovered constraint) — fall through to the per-opening sequential
        // loop below with its full #635 fallback / engulf / redundant-void machinery.
        let mut batch_consumed: Vec<bool> = vec![false; all_openings.len()];
        // Disjoint groups of opening indices (len ≥ 2 only); each is cut
        // INLINE at its first member's position in the sequential loop below,
        // so the relative order of batched vs sequential cutters matches the
        // pure sequential pass — only the order WITHIN a group (mutually
        // disjoint cutters, the provably order-free case) is collapsed.
        let mut batch_groups: Vec<Vec<(usize, Mesh)>> = Vec::new();
        let mut batch_group_of: FxHashMap<usize, usize> = FxHashMap::default();
        // Set on every successful cut; while false, a group's admission-time
        // extended cutters are still valid and reused verbatim.
        let mut host_mutated = false;

        // COAXIAL FOOTPRINT-UNION for OVERLAPPING clusters (issue #129, flag
        // `IFC_LITE_VOID_UNION`). Overlapping cutters can't join the disjoint batch
        // below and otherwise fall to the O(N) sequential exact path; this fuses
        // each overlapping coaxial cluster into disjoint re-extruded prisms and cuts
        // them in one `subtract_mesh_many`. See `coaxial_union`. Marks consumed
        // openings so the batch + sequential loops skip them; a cluster that fails
        // any guard is left unconsumed for the exact path (never worse than exact).
        self.coaxial_union_prepass(
            &mut result,
            &all_openings,
            &mut batch_consumed,
            &mut host_mutated,
            &clipper,
        );

        if all_openings.len() >= 2 {
            // Inflation pad: ≥ 2×(promote band 8·2⁻¹⁶ ≈ 122 µm + snap radius);
            // 1 mm is conservative and far below any real opening separation.
            // Touching/overlapping cutters land in DIFFERENT groups, cut in
            // sequence — overlap degrades gracefully to sequential behavior.
            const BATCH_PAD: f64 = 1.0e-3;
            struct Cand {
                idx: usize,
                /// The admission-time extended cutter (host PRE-cut). Reused at
                /// cut time while the host is still unmutated — the common case
                /// (groups are cut at their FIRST member, usually before any
                /// sequential cut) — so extension isn't paid twice.
                mesh: Mesh,
                lo: [f64; 3],
                hi: [f64; 3],
            }
            let mut cands: Vec<Cand> = Vec::new();
            for (idx, opening) in all_openings.iter().enumerate() {
                // Already cut by the coaxial/overlap-union prepass above.
                if batch_consumed[idx] {
                    continue;
                }
                let Some((opening_mesh, extrusion_dir)) = opening.mesh_cutter() else { continue };
                // Same admission guards as the sequential loop.
                let opening_valid = !opening_mesh.is_empty()
                    && opening_mesh.positions.iter().all(|&v| v.is_finite())
                    && opening_mesh.positions.len() >= 9;
                if !opening_valid {
                    continue;
                }
                let (result_min, result_max) = result.bounds();
                let (omn, omx) = opening_mesh.bounds();
                let no_overlap = omx.x < result_min.x
                    || omn.x > result_max.x
                    || omx.y < result_min.y
                    || omn.y > result_max.y
                    || omx.z < result_min.z
                    || omn.z > result_max.z;
                if no_overlap {
                    continue;
                }
                let open_vol = (omx.x - omn.x) as f64
                    * (omx.y - omn.y) as f64
                    * (omx.z - omn.z) as f64;
                if open_vol < Self::min_opening_volume(self.tessellation_quality) {
                    continue;
                }
                let Some(ext) = Self::batch_cutter(opening_mesh, extrusion_dir, &result) else {
                    continue;
                };
                let (lo, hi) = ext.bounds();
                // Engulf-class exclusion: a cutter whose extended AABB covers
                // the whole host on EVERY axis (3% slack, the sequential
                // engulf test) stays on the sequential path, where the
                // near-engulf and redundant-void guards live — batched it can
                // shave the host's outer shell (the #559171-family residual).
                let engulfs = {
                    let tol = ENGULF_TOLERANCE;
                    let covers = |omin: f64, omax: f64, wmin: f64, wmax: f64| {
                        let slack = (wmax - wmin).abs().max(1.0e-9) * tol;
                        omin <= wmin + slack && omax >= wmax - slack
                    };
                    covers(lo.x as f64, hi.x as f64, wall_min.x, wall_max.x)
                        && covers(lo.y as f64, hi.y as f64, wall_min.y, wall_max.y)
                        && covers(lo.z as f64, hi.z as f64, wall_min.z, wall_max.z)
                };
                if engulfs {
                    continue;
                }
                cands.push(Cand {
                    idx,
                    mesh: ext,
                    lo: [
                        lo.x as f64 - BATCH_PAD,
                        lo.y as f64 - BATCH_PAD,
                        lo.z as f64 - BATCH_PAD,
                    ],
                    hi: [
                        hi.x as f64 + BATCH_PAD,
                        hi.y as f64 + BATCH_PAD,
                        hi.z as f64 + BATCH_PAD,
                    ],
                });
            }
            // Greedy disjoint grouping, deterministic in opening order: a
            // candidate joins the first group whose EVERY member's inflated
            // AABB is disjoint from its own.
            let mut groups: Vec<Vec<usize>> = Vec::new();
            'cand: for ci in 0..cands.len() {
                for g in groups.iter_mut() {
                    let disjoint_from_all = g.iter().all(|&cj| {
                        let (a, b) = (&cands[ci], &cands[cj]);
                        a.hi[0] < b.lo[0]
                            || a.lo[0] > b.hi[0]
                            || a.hi[1] < b.lo[1]
                            || a.lo[1] > b.hi[1]
                            || a.hi[2] < b.lo[2]
                            || a.lo[2] > b.hi[2]
                    });
                    if disjoint_from_all {
                        g.push(ci);
                        continue 'cand;
                    }
                }
                groups.push(vec![ci]);
            }
            for g in &groups {
                if g.len() < 2 {
                    continue; // singleton: sequential loop handles it (full guards)
                }
                let gid = batch_groups.len();
                for &ci in g {
                    batch_group_of.insert(cands[ci].idx, gid);
                }
                batch_groups
                    .push(g.iter().map(|&ci| (cands[ci].idx, cands[ci].mesh.clone())).collect());
            }
        }

        for (opening_idx, opening) in all_openings.iter().enumerate() {
            if batch_consumed[opening_idx] {
                continue; // already handled by a batched disjoint group
            }
            // Batched group cut, attempted ONCE, inline at the group's first
            // member — so the relative order of batched vs sequential cutters
            // matches the pure sequential pass. On any failure (admission,
            // guards, or the kernel's conformity gate) the members fall back
            // to the per-opening sequential path below.
            if let Some(&gid) = batch_group_of.get(&opening_idx) {
                let members = std::mem::take(&mut batch_groups[gid]);
                if members.len() >= 2 {
                    // While the host is unmutated, the admission-time extended
                    // cutters (built against this exact host) are reused as-is;
                    // after any cut, members are re-extended against the
                    // CURRENT host — matching the sequential loop's reference,
                    // which extends each cutter against the (k−1)-cut host.
                    let mut extended: Vec<(usize, Mesh)> = Vec::with_capacity(members.len());
                    let mut admissible = true;
                    if !host_mutated {
                        extended = members;
                    } else {
                        for &(m_idx, _) in &members {
                            let ext = all_openings[m_idx]
                                .mesh_cutter()
                                .and_then(|(m, dir)| Self::batch_cutter(m, dir, &result));
                            let Some(ext) = ext else {
                                admissible = false;
                                break;
                            };
                            extended.push((m_idx, ext));
                        }
                    }
                    if admissible {
                        let cutters: Vec<&Mesh> = extended.iter().map(|(_, m)| m).collect();
                        let tri_before = result.triangle_count();
                        let outcome = if Self::batch_cutters_match_sequential(&result, &all_openings, &extended) {
                            clipper.subtract_mesh_many_retaining_miss(&result, &cutters)
                        } else {
                            clipper.subtract_mesh_many(&result, &cutters)
                        };
                        // #6516: retain the group's validated consolidation on
                        // a conforming miss; keeping the original host instead
                        // can discard useful seam repairs made by the singles.
                        if let GroupCut::Cut(csg_result) | GroupCut::Retessellated(csg_result) = outcome {
                            let min_tris = (tri_before / CSG_TRIANGLE_RETENTION_DIVISOR)
                                .max(MIN_VALID_TRIANGLES);
                            if !csg_result.is_empty() && csg_result.triangle_count() >= min_tris {
                                result = csg_result;
                                host_mutated = true;
                                for &(m_idx, _) in &extended {
                                    batch_consumed[m_idx] = true;
                                }
                            }
                        }
                    }
                }
                if batch_consumed[opening_idx] {
                    continue; // this opening was handled with its group
                }
            }
            // Normalize both exact-subtract variants into the same (mesh, min,
            // max, dir) shape. `DiagonalRectangular` (a clean but tilted box —
            // e.g. a roof-slope window or a slanted roof opening, #1007 defect B)
            // is a REAL solid cutter, so it MUST be subtracted exactly, never
            // approximated by a frame-rotated AABB: that legacy path
            // (`apply_diagonal_openings`) tore the host (101 boundary edges) and
            // left the void uncut. Route it through the same exact-mesh subtract
            // as `NonRectangular`; the kernel cuts the tilted box cleanly
            // (winding-robust after the defect-A orient-outward fix). The
            // mesh-bounds AABB + frame-depth direction still seed the #635
            // fallback, which only fires if the exact subtract no-ops.
            let normalized: Option<(&Mesh, Point3<f64>, Point3<f64>, Option<Vector3<f64>>)> =
                match *opening {
                    OpeningType::Rectangular(..) => None,
                    OpeningType::DiagonalRectangular(ref opening_mesh, ref frame) => {
                        let (mn, mx) = opening_mesh.bounds();
                        Some((
                            opening_mesh,
                            Point3::new(mn.x as f64, mn.y as f64, mn.z as f64),
                            Point3::new(mx.x as f64, mx.y as f64, mx.z as f64),
                            Some(frame.depth),
                        ))
                    }
                    OpeningType::NonRectangular(
                        ref opening_mesh,
                        ref open_min_pt,
                        ref open_max_pt,
                        ref extrusion_dir,
                    ) => Some((opening_mesh, *open_min_pt, *open_max_pt, *extrusion_dir)),
                };
            if let Some((opening_mesh, open_min_pt, open_max_pt, extrusion_dir)) = normalized {
                let open_min_pt = &open_min_pt;
                let open_max_pt = &open_max_pt;
                {
                    let opening_valid = !opening_mesh.is_empty()
                        && opening_mesh.positions.iter().all(|&v| v.is_finite())
                        && opening_mesh.positions.len() >= 9;

                    if !opening_valid {
                        continue;
                    }

                    let (result_min, result_max) = result.bounds();
                    let (open_min_f32, open_max_f32) = opening_mesh.bounds();
                    let no_overlap = open_max_f32.x < result_min.x
                        || open_min_f32.x > result_max.x
                        || open_max_f32.y < result_min.y
                        || open_min_f32.y > result_max.y
                        || open_max_f32.z < result_min.z
                        || open_min_f32.z > result_max.z;
                    if no_overlap {
                        continue;
                    }

                    let open_vol = (open_max_f32.x - open_min_f32.x)
                        * (open_max_f32.y - open_min_f32.y)
                        * (open_max_f32.z - open_min_f32.z);
                    // The 0.1 L volume floor filtered legacy-BSP CSG artefacts but
                    // also drops genuine small openings — bolt holes / sleeves in
                    // thin plates. At the two highest quality levels keep those
                    // holes (the exact kernel is stable on small cutters); only
                    // reject numerically degenerate cutters there. (issue #976)
                    let min_open_vol = Self::min_opening_volume(self.tessellation_quality) as f32;
                    if open_vol < min_open_vol {
                        continue;
                    }

                    // ENGULFING-SOLID VOID: when this opening's real solid
                    // CONTAINS the whole host, the exact subtract no-ops on the
                    // coincident shared faces and returns the host unchanged in
                    // volume (a spurious solid where the opening should be). A
                    // cheap AABB-engulf pre-check (false for an ordinary opening,
                    // which spans the host on at most its thickness axis) gates
                    // the O(host_v · opening_t) containment scan, which confirms
                    // TRUE solid containment — so a void whose AABB engulfs the
                    // host while its real profile excludes it is not affected.
                    // On a hit the host is fully consumed.
                    let aabb_engulfs = {
                        let tol = ENGULF_TOLERANCE_F32;
                        let covers = |omin: f32, omax: f32, hmin: f32, hmax: f32| {
                            let slack = (hmax - hmin).abs().max(1.0e-9) * tol;
                            omin <= hmin + slack && omax >= hmax - slack
                        };
                        covers(open_min_f32.x, open_max_f32.x, result_min.x, result_max.x)
                            && covers(open_min_f32.y, open_max_f32.y, result_min.y, result_max.y)
                            && covers(open_min_f32.z, open_max_f32.z, result_min.z, result_max.z)
                    };
                    if aabb_engulfs && opening_engulfs_host_solid(&result, opening_mesh) {
                        // Mark the host consumed so the element pipeline keeps
                        // the empty result instead of falling back to the un-cut
                        // host.
                        self.record_void_consumed_host(element_id);
                        result = Mesh::default();
                        host_mutated = true;
                        break;
                    }

                    let tri_before = result.triangle_count();
                    let failures_before = clipper.failure_count();
                    let mut csg_succeeded = false;
                    // PENETRATING CUTTER (PART A): push the opening's caps a hair
                    // PAST the host along its depth axis so a flush cap becomes a
                    // clean transversal crossing — the exact kernel then cuts the
                    // tilted, faceted roof opening with no bridging sliver (#1007
                    // host #1112). Falls back to the raw opening mesh when no depth
                    // direction is known (the kernel handles a true through-cutter
                    // anyway; the extension only matters for the flush-cap case).
                    let extended_opening = Self::sequential_cutter(
                        opening_mesh, extrusion_dir, &result,
                    );
                    let cutter = &extended_opening;
                    let outcome = clipper.subtract_mesh(&result, cutter);
                    // Nothing to cut, so the #635 fallback below must not cut a
                    // box either (#5362).
                    let kernel_found_no_overlap = outcome.found_no_overlap();
                    let kept = mesh_to_keep(outcome, &result);
                    // The host is still un-cut: the kernel found no real
                    // intersection, or bailed on a grazing/coplanar cutter.
                    let csg_unchanged = kept.is_none();
                    if let Some(csg_result) = kept {
                        let min_tris = (tri_before / CSG_TRIANGLE_RETENTION_DIVISOR)
                            .max(MIN_VALID_TRIANGLES);
                        if !csg_result.is_empty() && csg_result.triangle_count() >= min_tris {
                            result = csg_result;
                            host_mutated = true;
                            csg_succeeded = true;
                        }
                    }

                    // AABB fallback (issue #635): when CSG can't subtract the
                    // opening (most commonly because its triangulated profile
                    // exceeds `MAX_CSG_POLYGONS_PER_MESH`, i.e. circular /
                    // arched / arbitrary curved openings), cut the opening's
                    // axis-aligned bounding box instead. This leaves a square
                    // hole in place of a round one, but a square hole is
                    // dramatically less wrong than a missing void on a wall
                    // that is supposed to host a window or door.
                    // A re-tessellation this router refused on its own
                    // retention check is not a verdict: fall back as before.
                    let kernel_verdict_disjoint = kernel_found_no_overlap && csg_unchanged;
                    if !csg_succeeded && !kernel_verdict_disjoint {
                        let dir = extrusion_dir.or_else(|| {
                            Some(wall_thinnest_axis_dir(&wall_min, &wall_max))
                        });
                        let (final_min, final_max) = if let Some(dir) = dir {
                            self.extend_opening_along_direction(
                                *open_min_pt,
                                *open_max_pt,
                                wall_min,
                                wall_max,
                                dir,
                            )
                        } else {
                            (*open_min_pt, *open_max_pt)
                        };
                        // Near-engulf guard. When CSG returned the host *unchanged*
                        // (no cut) AND the opening's AABB covers the whole wall on
                        // every axis, the rectangular fallback would cut that
                        // engulfing box and delete the wall. This is the signature
                        // of a non-rectangular opening whose bounding box engulfs
                        // the host while its real profile excludes it: the kernel
                        // errors on the grazing/coplanar cutter and returns the
                        // un-cut host, which is already the correct result vs
                        // IfcOpenShell (advanced #555433's facade-scale void
                        // #555493). Keep the un-cut host instead of over-cutting.
                        // Normal windows/doors — including the issue-635 high-poly
                        // round openings the AABB box approximates — sit INSIDE the
                        // wall and never engulf it, so they still take the fallback.
                        // The 3% per-axis tolerance absorbs an opening that reaches
                        // ~flush with a wall face (its near plane).
                        let engulfs_host = {
                            let tol = ENGULF_TOLERANCE;
                            let covers = |omin: f64, omax: f64, wmin: f64, wmax: f64| {
                                let slack = (wmax - wmin).abs().max(1.0e-9) * tol;
                                omin <= wmin + slack && omax >= wmax - slack
                            };
                            covers(final_min.x, final_max.x, wall_min.x, wall_max.x)
                                && covers(final_min.y, final_max.y, wall_min.y, wall_max.y)
                                && covers(final_min.z, final_max.z, wall_min.z, wall_max.z)
                        };
                        // `capped` keys on the `OperandTooLarge` rejection: the
                        // #1109 per-boolean/-element escalation budget records it
                        // when a cut trips mid-arrangement and bails to the un-cut
                        // host (`csg/mod.rs`), so it is NOT always false — a
                        // grazing engulfing cutter that would run long trips the
                        // budget just as it errors on the coincident faces.
                        // Engulf suppression therefore applies regardless of WHY
                        // the CSG produced no change (budget trip or kernel error
                        // on the coincident faces): an engulfing cutter's AABB
                        // covers the whole host, so the #635 box-cut would delete
                        // the entire wall — a silent element deletion strictly
                        // worse than leaving a phantom (un-cut) solid. `capped` is
                        // now only read by the diagnostic below (it no longer
                        // gates the suppression), so it is unused in a release
                        // build that compiles out both the tracing and the
                        // debug/test `eprintln!` legs of `diag_warn!`.
                        #[allow(unused_variables)]
                        let capped = clipper.has_operand_too_large_since(failures_before);
                        // Issue #964: suppress the destructive AABB box when the
                        // host already has this void cut into it (a void
                        // double-encoded as both a profile inner curve and a
                        // redundant IfcOpeningElement). When every column through
                        // the opening footprint is already open in the host,
                        // cutting the bounding box would replace a correct
                        // round/polygonal hole with a rectangle. Unlike the
                        // engulf heuristic this is a positive void detection, so
                        // it overrides `capped` too (the void demonstrably
                        // exists — there is nothing left to approximate).
                        let probe_axis = dir.unwrap_or_else(|| {
                            wall_thinnest_axis_dir(&wall_min, &wall_max)
                        });
                        let redundant_void =
                            opening_redundant_with_host(&result, opening_mesh, &probe_axis);
                        let suppress_fallback =
                            redundant_void || (csg_unchanged && engulfs_host);
                        if !suppress_fallback {
                            // Diagnostic for issue #635: log the opening
                            // triangle count when the AABB fallback actually
                            // fires, so round windows (post profile
                            // simplification) can be confirmed to hit CSG and
                            // only genuinely-uncut voids land on the box cut.
                            // A genuine degraded mode, so warn-level under
                            // observability; the legacy debug/test-only
                            // eprintln is preserved otherwise.
                            crate::diag::diag_warn!(
                                { opening_tris = opening_mesh.triangle_count(),
                                  reason = "csg-produced-no-change",
                                  "voids: AABB fallback cut used for opening" }
                                else {
                                    #[cfg(any(debug_assertions, test))]
                                    eprintln!(
                                        "[issue-635] AABB fallback used: opening={} tris (CSG produced no change)",
                                        opening_mesh.triangle_count()
                                    );
                                }
                            );
                            // Deliberate degraded mode: this fallback removes
                            // the wall material inside the opening AABB but no
                            // longer emits reveal/recess quads (deleted with
                            // the legacy clip path), so its output has an open
                            // rim. It runs only when the kernel FAILED on an
                            // opening that reaches the host, never on one the
                            // kernel found disjoint (#5362).
                            let aabb_cut =
                                self.cut_rectangular_opening(&result, final_min, final_max);
                            #[cfg(feature = "opening-perf-trace")]
                            crate::opening_perf_trace::record(|c| {
                                c.aabb_fallback_attempts = c.aabb_fallback_attempts.saturating_add(1);
                                c.aabb_fallback_input_triangles = c.aabb_fallback_input_triangles.saturating_add(result.triangle_count() as u64);
                                c.aabb_fallback_output_triangles = c.aabb_fallback_output_triangles.saturating_add(aabb_cut.triangle_count() as u64);
                            });
                            if !aabb_cut.is_empty() && aabb_cut.triangle_count() != tri_before {
                                #[cfg(feature = "opening-perf-trace")]
                                crate::opening_perf_trace::record(|c| c.aabb_fallback_commits = c.aabb_fallback_commits.saturating_add(1));
                                result = aabb_cut;
                                host_mutated = true;
                            }
                        } else {
                            // The engulfing/redundant-void guard suppressed the
                            // #635 AABB box-cut. For an engulfing cutter the box
                            // covers the whole host, so cutting it would DELETE
                            // the wall; leaving the host un-cut (a phantom solid)
                            // is the strictly safer degrade. `capped` records
                            // whether the CSG bailed via the #1109 budget trip
                            // (`OperandTooLarge`) vs a kernel error on the
                            // coincident faces.
                            crate::diag::diag_warn!(
                                { opening_tris = opening_mesh.triangle_count(),
                                  capped = capped,
                                  reason = "engulfing-cutter-fallback-suppressed",
                                  "voids: AABB fallback suppressed for engulfing cutter (host left un-cut)" }
                                else {
                                    #[cfg(any(debug_assertions, test))]
                                    eprintln!(
                                        "[issue-635] AABB fallback SUPPRESSED for engulfing cutter: opening={} tris, capped={} (host left un-cut)",
                                        opening_mesh.triangle_count(),
                                        capped
                                    );
                                }
                            );
                        }
                    }
                }
            }
        }

        // NOTE (issue #635): the clipping planes from `IfcBooleanClippingResult`
        // are already applied by `BooleanClippingProcessor::process` during
        // `process_element` — the post-clip mesh is the *input* to this
        // function. Re-clipping here was a leftover from before that
        // processor existed; for `IfcPolygonalBoundedHalfSpace` it actively
        // *broke* gable walls, because `extract_half_space_plane` discards
        // the polygonal bound and the resulting unbounded plane chops off
        // the gable peak. Voids alone are applied here.

        // Drain whatever fallbacks the kernel logged during this element's
        // void / clip pass, attribute them to the host product, and stash on
        // the router so the caller can surface them (e.g. flagged in a
        // viewer overlay or asserted in regression tests).
        let kernel_failures = clipper.take_failures();
        if !kernel_failures.is_empty() {
            self.record_host_failure_summary(element_id, &kernel_failures);
            self.record_csg_failures(element_id, kernel_failures);
        }

        // WATERTIGHT SLIVER REFINEMENT (issue #1007): the exact-kernel cut of a
        // long, tilted faceted-BREP host facet can emit a high-aspect corner
        // sliver (a far-corner triangle fanned to two new rim vertices a few cm
        // apart) that lands ALONE in its plane bucket and so bypasses the
        // coplanar CDT. Bisect any >8:1 triangle's longest edge at its midpoint,
        // splitting BOTH incident triangles in lockstep so the mesh stays
        // watertight (no T-junction) and the midpoint lies ON the original edge
        // ⇒ cut volume is preserved exactly. A no-op on clean cuts (no triangle
        // exceeds 8:1), so it does not perturb the frozen corpus. Only runs when
        // a cut was actually attempted (`!ctx.is_noop()` guarantees this path).
        // This canonicalizer is likewise not a hygiene boundary: fresh sub-grid
        // candidates require handling by the remaining repair/clip/sweep path,
        // independently of the router's earlier source cleanup (#4797).
        let mut result = crate::facet_weld::refine_high_aspect_slivers(&result);

        // UNDER-CUT REPAIR: a self-intersecting tessellated cutter (garbage
        // vertices metres from the real opening) makes the kernel UNDER-cut — a
        // wall flap bridges the opening. Re-cut each such opening with a clean
        // box (removes only the opening prism, taking the flap, while preserving
        // and re-triangulating the wall around the hole). Done HERE, in the cut
        // frame (host + cutters share it), and BEFORE the spike clip so any
        // residual protrusion is still caught. A no-op when no cutter is
        // malformed — clean openings are never reshaped.
        recut_malformed_openings(&mut result, &ctx.malformed_opening_boxes());

        // SPURIOUS-FLAP CLIP: a subtract can only remove material, so the cut is
        // mathematically contained in the host's pre-cut AABB (`wall_min/max`);
        // any triangle poking past it is provably an artifact — a malformed
        // cutter's far-flung leaked flap (self-intersecting / tessellated void,
        // surfacing once a SECOND cutter perturbs the arrangement), OR the
        // flush-cap through-extension reveal overhang (`extend_opening_mesh_
        // through_host` pushes a flush cap ~0.3·depth past the host for a clean
        // transversal cut, so the subtract emits the reveal out to it — 0.105 m
        // past a 0.35 m floor slab, #1633). `clip_triangles_to_host_aabb` bounds
        // its jitter tolerance so a large host cannot leak the overhang. A no-op
        // on clean cuts.
        result.clip_triangles_to_host_aabb(
            [wall_min.x as f32, wall_min.y as f32, wall_min.z as f32],
            [wall_max.x as f32, wall_max.y as f32, wall_max.z as f32],
        );

        // STRAY-SHARD SWEEP: see `sweep::drop_faces_outside_host` (#1788).
        if host_mutated {
            result = drop_faces_outside_host(result, &original_host);
        }

        // Per-host cut-effect snapshot: tris_before / tris_after lets the
        // diagnostic surface the silent-no-op case (rectangular boxes
        // processed but the host mesh came out unchanged — the box
        // probably didn't intersect the wall, e.g. wrong placement).
        self.record_host_cut_effect(
            element_id,
            tris_before,
            result.triangle_count(),
            ctx.rect_opening_count(),
            host_bounds_capture,
        );

        result
    }
=======
}
>>>>>>> github-main

<<<<<<< custom-r7
||||||| previous-upstream
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
        let sub_meshes = self.process_element_with_submeshes_impl(
            element,
            decoder,
            false,
            None,
            SourceHygiene::IndexOnly,
        )?;
        if sub_meshes.is_empty() {
            return Ok(SubMeshCollection::new());
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
            voided_mesh.clean_degenerate();
            if !voided_mesh.is_empty() {
                voided
                    .sub_meshes
                    .push(SubMesh::new(geometry_id, voided_mesh));
            }
        }

        Ok(voided)
    }
=======
impl GeometryRouter {
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
        // The common program's styled void entry. Layered single-solid path
        // first: slice the element's base mesh by its material-layer buildup
        // AFTER subtracting voids, one sub-mesh per layer keyed by IfcMaterial
        // id, so layers show up as individual colors even when the geometry
        // is a single swept solid. With no openings that is all. Otherwise
        // the host is the un-voided sub-mesh walk, which itself first tries
        // the layered slicing without voids (an element whose voided slicing
        // declined can still slice uncut, and then each layer is cut); its
        // void context is classified ONCE per element, not per sub-mesh.
        let opening_ids = void_index.get(&element.id).map(Vec::as_slice).unwrap_or_default();
        crate::program::GeometryProgram::voided_styled(element, opening_ids).drain_styled(self, decoder)
    }
>>>>>>> github-main
}

#[cfg(test)]
mod flap_clip_tests;
#[cfg(test)]
mod batch_cutter_tests;
#[cfg(test)]
mod cut_effect_count_tests;
#[cfg(test)]
mod single_cut_outcome_tests;
<<<<<<< custom-r7

#[cfg(any(test, feature="test-support"))]
pub(crate) fn finish_source_fixture(stock: &Mesh, mesh: Mesh, precision: f64) -> Option<Mesh> {
    let mut router=GeometryRouter::with_scale(1.);
    router.precision_frame=Some(precision);
    router.finish_authored_mesh(stock,mesh,precision)
}
||||||| previous-upstream
=======
#[cfg(test)]
mod consumed_host_tests;
#[cfg(test)]
mod program_tests;
>>>>>>> github-main
