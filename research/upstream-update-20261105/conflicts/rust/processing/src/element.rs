// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Canonical per-element mesh production — THE single decision tree that turns
//! one IFC product (or type-product RepresentationMap) into renderable meshes.
//!
//! Both pipelines run this exact code:
//! - the native orchestrator (`processor.rs`) calls [`produce_element_meshes`]
//!   from its rayon loop with a fresh seeded decoder + router per element;
//! - the browser batch path (`wasm-bindings` `processGeometryBatch`) calls it
//!   per job with a warm per-batch decoder + router.
//!
//! Callers that own their model inputs capture them once into an immutable
//! [`OwnedMeshProductionContext`] snapshot and run this same tree through the
//! synchronous [`produce_element_meshes_owned`] driver (`owned_session`).
//!
//! History: the two pipelines used to carry diverging inline copies of this
//! tree, and fixes had to land twice (#858, #913, #957, #961, #1071). Any
//! change to mesh-production behaviour belongs HERE, exactly once. The only
//! sanctioned behavioural fork is [`TypeGeometryMode`] — a product
//! requirement, not drift: an export must never duplicate type geometry,
//! while the interactive viewer renders it tagged for its Model/Types switch.
//!
//! The converged decision tree (union of the strongest behaviours of both
//! former copies) runs in three phases: `plan` picks the strategy once, one
//! linear product continuation (`session`) issues, executes and accepts one
//! typed ticket per strategy's router work, and late presentation at
//! acceptance turns the executed parts into meshes: `presentation_source`
//! resolves every source-dependent field (colour, material name, palette
//! selection) into a source-free `presentation::ReadyBody`, and the
//! decoder-free `assembly_*` modules apply UV/texture, the palette split,
//! metadata and geometry_class through one body funnel.
//!
//! ```text
//! plan: representation gate (IfcAlignment exempt)
//! ├─ TypeProduct job (#957): render each planned RepresentationMap
//! │    (textures #961, geometry_class tag, styled-item colour)
//! └─ Product job:
//!    ├─ has openings → submesh-aware void cut (per-part colours survive)
//!    ├─ else        → submesh path for ALL types (per-item colours,
//!    │                per-item error skipping, #858 palette split per item)
//!    └─ ticket fallback chain when the submesh path produced nothing:
//!         void-aware single mesh → plain element → element-level #858 split
//!         → single coloured mesh
//! ```

use crate::style::{FullIndexedColourMap, GeometryStyleInfo};
use crate::types::mesh::{MeshData, MeshTextureData, RawInstanceOccurrence};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
use ifc_lite_geometry::{
    calculate_normals, orient_mesh_outward_verdict, BoolFailure,
    GeometryHasher, GeometryRouter, Mesh, ResolvedTextureMap, SubMeshCollection,
};
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::BTreeMap;

/// The f32-collapse degenerate backstop, its per-element tally, and the reason
/// that tally now gates the closure verdict. A CHILD module: it exists only to
/// serve this file's produce/emit cycle.
#[path = "element_degenerate.rs"]
mod degenerate;
mod element_color;
use element_color::{find_indexed_colour_for_element, infer_opening_subpart_material_name};
// Re-exported because they have callers outside this module: the colour
// resolvers from processor/, the style-source walks from style::finish_join.
pub(crate) use element_color::{find_geometry_item_color, resolve_color_for_representation_map};
pub(crate) use element_color::{find_geometry_item_style_source, product_shape_style_source, representation_map_style_source};

mod types;
pub use types::*;
mod plan;
pub use plan::plan_type_geometry;
mod assembly_job;
use assembly_job::AssemblyJob;
mod presentation;
mod presentation_source;
mod assembly_submeshes;
mod assembly_fallback;
mod assembly_types;
mod model_context;
pub use model_context::{
    OwnedMeshProductionContext, OwnedMeshProductionData, ProductionContextError, ProductionContextId,
    ProductionModel,
};
mod session;
mod session_state;
mod session_protocol;
mod session_owner;
mod session_work;
mod session_accept;
mod session_run;
mod session_canonical;
#[cfg(test)]
mod session_resumable;
mod owned_session;
pub use owned_session::produce_element_meshes_owned;

/// THE canonical per-element mesh producer.
///
/// Decoder and router are caller-supplied so each pipeline keeps its reuse
/// policy: the native rayon loop builds a fresh seeded decoder + router per
/// element; the browser batch path reuses one warm pair per batch. The
/// decoder MUST have its unit-scale caches seeded
/// (`EntityDecoder::seed_unit_scales`) — otherwise arc tessellation re-pays
/// an O(file) IFCPROJECT scan per fresh decoder.
pub fn produce_element_meshes(
    job: &ElementMeshJob<'_>,
    ctx: &MeshProductionContext<'_>,
    opts: &MeshProductionOptions,
    decoder: &mut EntityDecoder,
    router: &GeometryRouter,
) -> ProducedElementMeshes {
    // One canonical continuation per element (`session`). Its per-element CSG
    // escalation budget (#1109), degenerate tally and pending reports are one
    // owned state, installed for each synchronous slice and restored on
    // return or unwind: a rayon work-steal can run another element to
    // completion inside this one, and a registered processor may produce a
    // nested element on the same decoder and router.
    session_canonical::produce(job, ctx, opts, decoder, router)
}

/// geometry_class for the per-layer slices of a material-layer wall. The wall's
/// slices have verified outward winding, so the 3D renderer draws THIS class
/// BACKFACE-CULLED — the build-up shows on the faces/edges but the interior
/// coincident caps never rasterise, so the thin stacked solids don't z-fight
/// into a hollow shell. The 2D/section cut consumes the same class (never
/// culled) for its per-layer fills.
pub const GEOM_CLASS_LAYER_SLICE: u8 = 3;

#[path = "element_mesh_build.rs"]
mod element_mesh_build;
use element_mesh_build::build_mesh_data;

<<<<<<< custom-r7
    if has_openings {
        // Voided elements: submesh-aware cut FIRST, so per-part colours
        // survive the void subtraction (a voided window keeps frame/glass
        // split; a voided multi-layer wall keeps its layer colours).
        if let Ok(sub_meshes) =
            router.process_element_with_submeshes_and_voids(job.entity, decoder, ctx.void_index)
        {
            if !sub_meshes.is_empty() {
                let (out, occ) =
                    emit_sub_meshes(job, sub_meshes, element_color, ctx, decoder, hasher, (layer_class, router.take_source_boundary_verdict(job.id)));
                if !out.is_empty() || !occ.is_empty() {
                    return (out, occ);
                }
            }
        }
    } else {
        // Submesh path for ALL types: per-geometry-item colours (window glass
        // transparency, multi-material doors) and per-item error skipping —
        // one unsupported representation item no longer blanks the whole
        // element (`process_element` aborts with `?`). #858 palette split
        // happens per item inside `emit_sub_meshes`.
        let submeshes = router.process_element_with_submeshes_textured(job.entity, decoder, ctx.texture_index);
        // Annotation validation failures are terminal, not another meshing strategy.
        // Retrying the fallback chain would count one refused fill three times.
        if job.ifc_type == IfcType::IfcAnnotation && submeshes.is_err() { return (Vec::new(), Vec::new()); }
        if let Ok(sub_meshes) = submeshes {
            if !sub_meshes.is_empty() {
                let (out, occ) =
                    emit_sub_meshes(job, sub_meshes, element_color, ctx, decoder, hasher, (layer_class, None));
                // #1623 Phase 2: a pure don't-bake occurrence produces NO flat mesh
                // (only instance placeholders); treat that as success so the fallback
                // chain below does not re-materialize the element flat.
                if !out.is_empty() || !occ.is_empty() {
                    return (out, occ);
                }
            }
        }
    }
||||||| previous-upstream
    if has_openings {
        // Voided elements: submesh-aware cut FIRST, so per-part colours
        // survive the void subtraction (a voided window keeps frame/glass
        // split; a voided multi-layer wall keeps its layer colours).
        if let Ok(sub_meshes) =
            router.process_element_with_submeshes_and_voids(job.entity, decoder, ctx.void_index)
        {
            if !sub_meshes.is_empty() {
                let (out, occ) =
                    emit_sub_meshes(job, sub_meshes, element_color, ctx, decoder, hasher, layer_class);
                if !out.is_empty() || !occ.is_empty() {
                    return (out, occ);
                }
            }
        }
    } else {
        // Submesh path for ALL types: per-geometry-item colours (window glass
        // transparency, multi-material doors) and per-item error skipping —
        // one unsupported representation item no longer blanks the whole
        // element (`process_element` aborts with `?`). #858 palette split
        // happens per item inside `emit_sub_meshes`.
        let submeshes = router.process_element_with_submeshes_textured(job.entity, decoder, ctx.texture_index);
        // Annotation validation failures are terminal, not another meshing strategy.
        // Retrying the fallback chain would count one refused fill three times.
        if job.ifc_type == IfcType::IfcAnnotation && submeshes.is_err() { return (Vec::new(), Vec::new()); }
        if let Ok(sub_meshes) = submeshes {
            if !sub_meshes.is_empty() {
                let (out, occ) =
                    emit_sub_meshes(job, sub_meshes, element_color, ctx, decoder, hasher, layer_class);
                // #1623 Phase 2: a pure don't-bake occurrence produces NO flat mesh
                // (only instance placeholders); treat that as success so the fallback
                // chain below does not re-materialize the element flat.
                if !out.is_empty() || !occ.is_empty() {
                    return (out, occ);
                }
            }
        }
    }
=======
#[cfg(test)]
#[path = "element_tests.rs"]
mod tests;
>>>>>>> github-main

#[cfg(test)]
mod phase_tests;

#[cfg(test)]
mod presentation_tests;

<<<<<<< custom-r7
    let source_boundary=if needs_fallback {None}else{router.take_source_boundary_verdict(job.id)};
    let mut out = Vec::new();
    for mesh in parts_candidate.into_iter().flatten().filter(|mesh| !mesh.is_empty()) {
        out.extend(emit_fallback_mesh(job, mesh, element_color, ctx, decoder, hasher, source_boundary));
    }
    (out, Vec::new())
}
||||||| previous-upstream
    let mut out = Vec::new();
    for mesh in parts_candidate.into_iter().flatten().filter(|mesh| !mesh.is_empty()) {
        out.extend(emit_fallback_mesh(job, mesh, element_color, ctx, decoder, hasher));
    }
    (out, Vec::new())
}
=======
#[cfg(test)]
mod presentation_palette_tests;
>>>>>>> github-main

<<<<<<< custom-r7
/// Emit one assembled fallback body (a single frame part): outward winding,
/// the #858 indexed-colour split when it still applies, else one mesh.
fn emit_fallback_mesh(
    job: &ElementMeshJob<'_>,
    mut mesh: Mesh,
    element_color: [f32; 4],
    ctx: &MeshProductionContext<'_>,
    decoder: &mut EntityDecoder,
    hasher: &mut Option<GeometryHasher>,
    source_boundary: Option<ifc_lite_geometry::OrientVerdict>,
) -> Vec<MeshData> {
    // Make the assembled body consistently outward-wound. A faceted brep (IFC
    // face loops are not reliably outward) or a merged multi-item body (extrusion
    // unioned with a boolean cut) can carry MIXED winding that corrupts signed
    // volume and the smooth normals computed below. No-op for already-consistent
    // bodies (every extrusion), so their index buffer + normals are untouched; a
    // flip invalidates any baked normals, so recompute them.
    //
    // The verdict rides along to the hasher below: this pass is the only place
    // that knows whether the assembled body is a closed orientable solid, and
    // without that a per-element volume cannot be emitted honestly (#1891).
    let verdict = source_boundary.unwrap_or_else(||orient_mesh_outward_verdict(&mut mesh));
    if verdict.flipped {
        calculate_normals(&mut mesh);
    }
||||||| previous-upstream
/// Emit one assembled fallback body (a single frame part): outward winding,
/// the #858 indexed-colour split when it still applies, else one mesh.
fn emit_fallback_mesh(
    job: &ElementMeshJob<'_>,
    mut mesh: Mesh,
    element_color: [f32; 4],
    ctx: &MeshProductionContext<'_>,
    decoder: &mut EntityDecoder,
    hasher: &mut Option<GeometryHasher>,
) -> Vec<MeshData> {
    // Make the assembled body consistently outward-wound. A faceted brep (IFC
    // face loops are not reliably outward) or a merged multi-item body (extrusion
    // unioned with a boolean cut) can carry MIXED winding that corrupts signed
    // volume and the smooth normals computed below. No-op for already-consistent
    // bodies (every extrusion), so their index buffer + normals are untouched; a
    // flip invalidates any baked normals, so recompute them.
    //
    // The verdict rides along to the hasher below: this pass is the only place
    // that knows whether the assembled body is a closed orientable solid, and
    // without that a per-element volume cannot be emitted honestly (#1891).
    let verdict = orient_mesh_outward_verdict(&mut mesh);
    if verdict.flipped {
        calculate_normals(&mut mesh);
    }
=======
#[cfg(test)]
mod presentation_provenance_tests;
>>>>>>> github-main

<<<<<<< custom-r7
    // Multi-colour IfcIndexedColourMap → one mesh per palette group (#858),
    // resolved by walking the element's representation for the colour-mapped
    // face set. Only applies while the produced triangle count still matches
    // the face set's CoordIndex (no CSG/void retopology) — the splitter
    // guards this; otherwise the single dominant-coloured mesh below wins.
    if !ctx.indexed_colour_full.is_empty() {
        if let Some(full) =
            find_indexed_colour_for_element(job.entity, ctx.indexed_colour_full, decoder)
        {
            let geometry_id = full.geometry_id;
            if let Some(groups) = crate::style::split_mesh_by_indexed_colour(&mesh, full) {
                if let Some(h) = hasher.as_mut() {
                    // The palette split below only partitions triangles; the
                    // verdict from the un-split body is the one that describes
                    // this hashed buffer.
                    h.add_oriented_mesh(&mesh.positions, &mesh.indices, mesh.origin, verdict);
                }
                let mut out: Vec<MeshData> = Vec::with_capacity(groups.len());
                for (color, mut part) in groups {
                    if part.normals.len() != part.positions.len() {
                        calculate_normals(&mut part);
                    }
                    out.push(build_mesh_data(
                        job,
                        part,
                        color.to_array(),
                        None,
                        Some(geometry_id),
                        false,
                        0,
                        ctx,
                        None, source_boundary.is_some()
                    ));
                }
                if !out.is_empty() {
                    return out;
                }
            }
        }
    }
||||||| previous-upstream
    // Multi-colour IfcIndexedColourMap → one mesh per palette group (#858),
    // resolved by walking the element's representation for the colour-mapped
    // face set. Only applies while the produced triangle count still matches
    // the face set's CoordIndex (no CSG/void retopology) — the splitter
    // guards this; otherwise the single dominant-coloured mesh below wins.
    if !ctx.indexed_colour_full.is_empty() {
        if let Some(full) =
            find_indexed_colour_for_element(job.entity, ctx.indexed_colour_full, decoder)
        {
            let geometry_id = full.geometry_id;
            if let Some(groups) = crate::style::split_mesh_by_indexed_colour(&mesh, full) {
                if let Some(h) = hasher.as_mut() {
                    // The palette split below only partitions triangles; the
                    // verdict from the un-split body is the one that describes
                    // this hashed buffer.
                    h.add_oriented_mesh(&mesh.positions, &mesh.indices, mesh.origin, verdict);
                }
                let mut out: Vec<MeshData> = Vec::with_capacity(groups.len());
                for (color, mut part) in groups {
                    if part.normals.len() != part.positions.len() {
                        calculate_normals(&mut part);
                    }
                    out.push(build_mesh_data(
                        job,
                        part,
                        color.to_array(),
                        None,
                        Some(geometry_id),
                        false,
                        0,
                        ctx,
                        None,
                    ));
                }
                if !out.is_empty() {
                    return out;
                }
            }
        }
    }
=======
#[cfg(test)]
mod presentation_provenance_soundness_tests;
>>>>>>> github-main

<<<<<<< custom-r7
    if mesh.normals.len() != mesh.positions.len() {
        calculate_normals(&mut mesh);
    }
    if let Some(h) = hasher.as_mut() {
        h.add_oriented_mesh(&mesh.positions, &mesh.indices, mesh.origin, verdict);
    }
    vec![build_mesh_data(job, mesh, element_color, None, None, false, 0, ctx, None, source_boundary.is_some())]
}
||||||| previous-upstream
    if mesh.normals.len() != mesh.positions.len() {
        calculate_normals(&mut mesh);
    }
    if let Some(h) = hasher.as_mut() {
        h.add_oriented_mesh(&mesh.positions, &mesh.indices, mesh.origin, verdict);
    }
    vec![build_mesh_data(job, mesh, element_color, None, None, false, 0, ctx, None)]
}
=======
#[cfg(test)]
mod owned_context_tests;
>>>>>>> github-main

<<<<<<< custom-r7
/// Emit a sub-mesh collection: per-item colour resolution through the
/// canonical `resolve_submesh_color` precedence (#913 §4.2), material-name
/// inference for window/door parts, and the #858 per-item palette split.
fn emit_sub_meshes(
    job: &ElementMeshJob<'_>,
    sub_meshes: SubMeshCollection,
    element_color: [f32; 4],
    ctx: &MeshProductionContext<'_>,
    decoder: &mut EntityDecoder,
    hasher: &mut Option<GeometryHasher>,
    // geometry_class stamped on every emitted sub-mesh. 0 for normal occurrence
    // geometry; GEOM_CLASS_LAYER_SLICE (3) when these are the per-layer slices of
    // a material-layer wall — a section-only detail the 3D renderer skips (the
    // wall renders as one solid) but the 2D/section cut consumes.
    (slice_class, source_boundary): (u8, Option<ifc_lite_geometry::OrientVerdict>),
) -> (Vec<MeshData>, Vec<RawInstanceOccurrence>) {
    // Read ONCE, before the loop consumes the collection: what the ids MEAN is
    // a property of the collection, not of any individual sub-mesh (#3199).
    let ids_are_materials = sub_meshes.ids_are_materials;
    let mut out: Vec<MeshData> = Vec::with_capacity(sub_meshes.len());
    let mut occurrences: Vec<RawInstanceOccurrence> = Vec::new();
    // Material colours for this element, used when a sub-mesh has no direct
    // style — alternated so frame (opaque) and glazing (transparent) split
    // across the window's parts (#913 §2.3).
    let material_colors = ctx.element_material_colors.get(&job.id);
    let mut mat_color_idx = 0usize;
||||||| previous-upstream
/// Emit a sub-mesh collection: per-item colour resolution through the
/// canonical `resolve_submesh_color` precedence (#913 §4.2), material-name
/// inference for window/door parts, and the #858 per-item palette split.
fn emit_sub_meshes(
    job: &ElementMeshJob<'_>,
    sub_meshes: SubMeshCollection,
    element_color: [f32; 4],
    ctx: &MeshProductionContext<'_>,
    decoder: &mut EntityDecoder,
    hasher: &mut Option<GeometryHasher>,
    // geometry_class stamped on every emitted sub-mesh. 0 for normal occurrence
    // geometry; GEOM_CLASS_LAYER_SLICE (3) when these are the per-layer slices of
    // a material-layer wall — a section-only detail the 3D renderer skips (the
    // wall renders as one solid) but the 2D/section cut consumes.
    slice_class: u8,
) -> (Vec<MeshData>, Vec<RawInstanceOccurrence>) {
    // Read ONCE, before the loop consumes the collection: what the ids MEAN is
    // a property of the collection, not of any individual sub-mesh (#3199).
    let ids_are_materials = sub_meshes.ids_are_materials;
    let mut out: Vec<MeshData> = Vec::with_capacity(sub_meshes.len());
    let mut occurrences: Vec<RawInstanceOccurrence> = Vec::new();
    // Material colours for this element, used when a sub-mesh has no direct
    // style — alternated so frame (opaque) and glazing (transparent) split
    // across the window's parts (#913 §2.3).
    let material_colors = ctx.element_material_colors.get(&job.id);
    let mut mat_color_idx = 0usize;
=======
#[cfg(test)]
mod session_tests;
>>>>>>> github-main

<<<<<<< custom-r7
    for sub in sub_meshes.sub_meshes {
        let mut sub_mesh = sub.mesh;
        if sub_mesh.is_empty() {
            // #1623 Phase 2 don't-bake: an EMPTY sub-mesh carrying instanceable
            // InstanceMeta is a non-template occurrence of a shared template. Convert
            // it to a RawInstanceOccurrence (resolving its colour EXACTLY as a
            // materialized sub-mesh would, keyed on the same nested-solid geometry_id)
            // instead of dropping it. `transform` was folded into `im.transform` by
            // `apply_submesh_placement`; we compose the full pre-RTC world transform
            // here and let the streaming finalize derive the template-relative mat4.
            if let Some(im) = sub_mesh.instance_meta.as_ref().filter(|im| im.instanceable) {
                let style = ctx.geometry_style_index.get(&sub.geometry_id);
                let direct_color = style.map(|s| s.color).or_else(|| {
                    find_geometry_item_color(sub.geometry_id, ctx.geometry_style_index, decoder)
                });
                let color = crate::style::resolve_submesh_color(
                    direct_color,
                    material_colors.map(|v| v.as_slice()),
                    &mut mat_color_idx,
                    element_color,
                );
                occurrences.push(RawInstanceOccurrence {
                    express_id: job.id,
                    ifc_type: job.ifc_type.name().to_string(),
                    global_id: job.metadata.and_then(|m| m.global_id.clone()),
                    name: job.metadata.and_then(|m| m.name.clone()),
                    presentation_layer: job.metadata.and_then(|m| m.presentation_layer.clone()),
                    color,
                    rep_identity: im.rep_identity,
                    world_transform: compose_instance_world_row_major(im),
                    // #2985: the id `build_mesh_data` would have stamped had this
                    // sub-mesh materialized. ONE home for the #3199 discriminator and the
                    // 0-filter — two spellings drift invisibly ("no item id" reads as "no item").
                    geometry_item_id: MeshData::style_geometry_item_id(Some(sub.geometry_id), ids_are_materials),
                });
            }
            continue;
        }
        // Consistently outward-wind each sub-body (see the single-mesh path); a
        // flip invalidates baked normals, so recompute on flip or when absent.
        // The verdict is per SUB-BODY, which is also the hasher's segment
        // granularity, so closedness is attributed to exactly what it describes.
        let verdict = source_boundary.unwrap_or_else(||orient_mesh_outward_verdict(&mut sub_mesh));
        if verdict.flipped || sub_mesh.normals.len() != sub_mesh.positions.len() {
            calculate_normals(&mut sub_mesh);
        }
||||||| previous-upstream
    for sub in sub_meshes.sub_meshes {
        let mut sub_mesh = sub.mesh;
        if sub_mesh.is_empty() {
            // #1623 Phase 2 don't-bake: an EMPTY sub-mesh carrying instanceable
            // InstanceMeta is a non-template occurrence of a shared template. Convert
            // it to a RawInstanceOccurrence (resolving its colour EXACTLY as a
            // materialized sub-mesh would, keyed on the same nested-solid geometry_id)
            // instead of dropping it. `transform` was folded into `im.transform` by
            // `apply_submesh_placement`; we compose the full pre-RTC world transform
            // here and let the streaming finalize derive the template-relative mat4.
            if let Some(im) = sub_mesh.instance_meta.as_ref().filter(|im| im.instanceable) {
                let style = ctx.geometry_style_index.get(&sub.geometry_id);
                let direct_color = style.map(|s| s.color).or_else(|| {
                    find_geometry_item_color(sub.geometry_id, ctx.geometry_style_index, decoder)
                });
                let color = crate::style::resolve_submesh_color(
                    direct_color,
                    material_colors.map(|v| v.as_slice()),
                    &mut mat_color_idx,
                    element_color,
                );
                occurrences.push(RawInstanceOccurrence {
                    express_id: job.id,
                    ifc_type: job.ifc_type.name().to_string(),
                    global_id: job.metadata.and_then(|m| m.global_id.clone()),
                    name: job.metadata.and_then(|m| m.name.clone()),
                    presentation_layer: job.metadata.and_then(|m| m.presentation_layer.clone()),
                    color,
                    rep_identity: im.rep_identity,
                    world_transform: compose_instance_world_row_major(im),
                    // #2985: the id `build_mesh_data` would have stamped had this
                    // sub-mesh materialized. ONE home for the #3199 discriminator and the
                    // 0-filter — two spellings drift invisibly ("no item id" reads as "no item").
                    geometry_item_id: MeshData::style_geometry_item_id(Some(sub.geometry_id), ids_are_materials),
                });
            }
            continue;
        }
        // Consistently outward-wind each sub-body (see the single-mesh path); a
        // flip invalidates baked normals, so recompute on flip or when absent.
        // The verdict is per SUB-BODY, which is also the hasher's segment
        // granularity, so closedness is attributed to exactly what it describes.
        let verdict = orient_mesh_outward_verdict(&mut sub_mesh);
        if verdict.flipped || sub_mesh.normals.len() != sub_mesh.positions.len() {
            calculate_normals(&mut sub_mesh);
        }
=======
#[cfg(test)]
mod session_work_tests;
>>>>>>> github-main

#[cfg(test)]
mod session_canonical_tests;

#[cfg(test)]
mod session_threaded_tests;

<<<<<<< custom-r7
        // Textured face set (#1781): thread the per-vertex UVs through the
        // weld (kept 1:1 with positions, seams stay split) and attach the
        // texture, mirroring the type-geometry path (#961). The length guard
        // drops the texture instead of sampling garbage if any upstream step
        // rebuilt vertices without maintaining the UV channel.
        if let (Some(uvs), Some(texture)) = (sub.uvs, sub.texture.as_ref()) {
            if uvs.len() / 2 == sub_mesh.positions.len() / 3 {
                let mut mesh_data = build_mesh_data(
                    job,
                    sub_mesh,
                    color,
                    material_name,
                    Some(sub.geometry_id),
                    ids_are_materials,
                    slice_class,
                    ctx,
                    Some(uvs), source_boundary.is_some()
                );
                mesh_data.texture = Some(MeshTextureData::from_attachment(texture));
                out.push(mesh_data);
                continue;
            }
        }
||||||| previous-upstream
        // Textured face set (#1781): thread the per-vertex UVs through the
        // weld (kept 1:1 with positions, seams stay split) and attach the
        // texture, mirroring the type-geometry path (#961). The length guard
        // drops the texture instead of sampling garbage if any upstream step
        // rebuilt vertices without maintaining the UV channel.
        if let (Some(uvs), Some(texture)) = (sub.uvs, sub.texture.as_ref()) {
            if uvs.len() / 2 == sub_mesh.positions.len() / 3 {
                let mut mesh_data = build_mesh_data(
                    job,
                    sub_mesh,
                    color,
                    material_name,
                    Some(sub.geometry_id),
                    ids_are_materials,
                    slice_class,
                    ctx,
                    Some(uvs),
                );
                mesh_data.texture = Some(MeshTextureData::from_attachment(texture));
                out.push(mesh_data);
                continue;
            }
        }
=======
#[cfg(test)]
mod session_diagnostic_tests;
>>>>>>> github-main

<<<<<<< custom-r7
        // #858: a face set with a per-triangle colour map splits into one
        // mesh per palette group (guards inside the splitter: triangle count
        // must still match, ≥2 distinct colours). Palette colours supersede
        // the resolved style colour for the split parts.
        if let Some(full) = ctx.indexed_colour_full.get(&sub.geometry_id) {
            if let Some(groups) = crate::style::split_mesh_by_indexed_colour(&sub_mesh, full) {
                for (rgba, mut part) in groups {
                    if part.normals.len() != part.positions.len() {
                        calculate_normals(&mut part);
                    }
                    out.push(build_mesh_data(
                        job,
                        part,
                        rgba.to_array(),
                        None,
                        Some(sub.geometry_id),
                        ids_are_materials,
                        slice_class,
                        ctx,
                        None, source_boundary.is_some()
                    ));
                }
                continue;
            }
        }
||||||| previous-upstream
        // #858: a face set with a per-triangle colour map splits into one
        // mesh per palette group (guards inside the splitter: triangle count
        // must still match, ≥2 distinct colours). Palette colours supersede
        // the resolved style colour for the split parts.
        if let Some(full) = ctx.indexed_colour_full.get(&sub.geometry_id) {
            if let Some(groups) = crate::style::split_mesh_by_indexed_colour(&sub_mesh, full) {
                for (rgba, mut part) in groups {
                    if part.normals.len() != part.positions.len() {
                        calculate_normals(&mut part);
                    }
                    out.push(build_mesh_data(
                        job,
                        part,
                        rgba.to_array(),
                        None,
                        Some(sub.geometry_id),
                        ids_are_materials,
                        slice_class,
                        ctx,
                        None,
                    ));
                }
                continue;
            }
        }
=======
#[cfg(test)]
mod session_extension_tests;
>>>>>>> github-main

<<<<<<< custom-r7
        out.push(build_mesh_data(
            job,
            sub_mesh,
            color,
            material_name,
            Some(sub.geometry_id),
            ids_are_materials,
            slice_class,
            ctx,
            None, source_boundary.is_some()
        ));
    }
    (out, occurrences)
}
||||||| previous-upstream
        out.push(build_mesh_data(
            job,
            sub_mesh,
            color,
            material_name,
            Some(sub.geometry_id),
            ids_are_materials,
            slice_class,
            ctx,
            None,
        ));
    }
    (out, occurrences)
}
=======
#[cfg(test)]
mod owned_reply_tests;
>>>>>>> github-main

#[cfg(test)]
mod session_stack_tests;

#[cfg(test)]
mod session_unwind_tests;

#[cfg(test)]
mod session_retry_tests;

<<<<<<< custom-r7
        for (mut mesh, uvs, texture) in parts {
            if mesh.is_empty() {
                continue;
            }
            if mesh.normals.len() != mesh.positions.len() {
                calculate_normals(&mut mesh);
            }
            // Thread the per-vertex UVs through `build_mesh_data` so the source
            // weld remaps them WITH the deduped positions (and keeps texture
            // seams split). Only textured parts carry UVs; untextured parts pass
            // `None` and get the full position+normal weld.
            let part_uvs = if texture.is_some() { Some(uvs) } else { None };
            let mut mesh_data =
                build_mesh_data(job, mesh, color, None, None, false, geometry_class, ctx, part_uvs, false);
            if let Some(tex) = texture {
                // UVs were already welded onto `mesh_data`; attach only the
                // texture (decoded image or #1781 external reference) here.
                mesh_data.texture = Some(MeshTextureData::from_attachment(&tex));
            }
            out.push(mesh_data);
        }
    }
    out
}
||||||| previous-upstream
        for (mut mesh, uvs, texture) in parts {
            if mesh.is_empty() {
                continue;
            }
            if mesh.normals.len() != mesh.positions.len() {
                calculate_normals(&mut mesh);
            }
            // Thread the per-vertex UVs through `build_mesh_data` so the source
            // weld remaps them WITH the deduped positions (and keeps texture
            // seams split). Only textured parts carry UVs; untextured parts pass
            // `None` and get the full position+normal weld.
            let part_uvs = if texture.is_some() { Some(uvs) } else { None };
            let mut mesh_data =
                build_mesh_data(job, mesh, color, None, None, false, geometry_class, ctx, part_uvs);
            if let Some(tex) = texture {
                // UVs were already welded onto `mesh_data`; attach only the
                // texture (decoded image or #1781 external reference) here.
                mesh_data.texture = Some(MeshTextureData::from_attachment(&tex));
            }
            out.push(mesh_data);
        }
    }
    out
}
=======
#[cfg(test)]
mod session_resource_tests;
>>>>>>> github-main

#[cfg(test)]
mod session_publication_tests;

#[cfg(test)]
mod session_steal_tests;

#[cfg(feature = "retained-runtime")]
mod session_retained;
/// Experimental transport seam; it grants no final-product authority.
#[doc(hidden)]
#[cfg(feature = "retained-runtime")]
pub mod retained_runtime {
    pub use super::session_retained::runtime::{
        RetainedRuntime, AsyncRetainedExecutor, NumericalReceipt,
        ReceiptDomain, ReceiptEvidence, Invocation, Operand, NumericalLimits,
        RuntimeFault, ReceiptMesh,
    };
    pub use super::session_retained::refusal::{RetainedProductRefusal, RefusalOrigin};
    pub use super::session_retained::error::RetainedExecutionError;
    pub use super::session_retained::publication::{NO_PALETTE_ENTRY, PartPalette, PartSurface, PartTexture, ShapeOnlyProduct, ShapePart, PresentationObligationsUnmet, PartAppearance, PartFaces, FaceKey};
    pub use super::session_retained::affine_final::{bake_mesh, affine_chord_admissible, affine_sweep_surfaces_certifiable, effective_radius_through_affine};
    pub use super::session_retained::clip_sliver::{volume_beyond, within_clip_limit};
    pub use super::session_retained::presentation::resolve_appearances;
    pub use super::session_retained::witness::RuntimeProductWitness;
    pub use super::session_retained::model::{run_model, run_model_with_worker, ModelOptions, ModelSummary, ProductOutcome, ProductBudgetSpec};
    pub use crate::processor::entry_points::{canonical_element_jobs, canonical_element_jobs_and_styled_items, canonical_type_maps};
    pub use super::session_retained::admission::{admit_product, RetainedAdmissionError};
}
