/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

//! The element -> spatial-container lookup tables of `SpatialHierarchyData`
//! (`element_to_storey` and friends), split out of `spatial.rs` for the
//! module-size ratchet. Built after the node tree so the storey ruling can
//! tell a project-reachable storey from a rescued orphan (#4310).

use super::super::types::{EntityMetadata, Relationship, SpatialNode};
use super::super::cancellation::Cancellation;
use rustc_hash::{FxHashMap, FxHashSet};

pub(super) struct SpatialPredicates {
    pub spatial: fn(&str) -> bool,
    pub building: fn(&str) -> bool,
    pub space: fn(&str) -> bool,
}

pub(super) struct ElementLookups {
    pub storey: Vec<(u32, u32)>,
    pub building: Vec<(u32, u32)>,
    pub site: Vec<(u32, u32)>,
    pub space: Vec<(u32, u32)>,
}

/// `IFCRELCONTAINEDINSPATIALSTRUCTURE` pairs bucketed by container type.
/// `project_reachable` is the node set BEFORE orphan rescue; only those
/// storeys compete for the first-declared storey slot.
pub(super) fn build_element_lookups(
    relationships: &[Relationship],
    entity_map: &FxHashMap<u32, &EntityMetadata>,
    nodes_map: &FxHashMap<u32, SpatialNode>,
    project_reachable: &FxHashSet<u32>,
    predicates: SpatialPredicates,
    cancel: Cancellation<'_>,
) -> ElementLookups {
    let mut element_to_storey = Vec::new();
    let mut element_to_building = Vec::new();
    let mut element_to_site = Vec::new();
    let mut element_to_space = Vec::new();

    // #4310 parity: `packages/parser`'s `elementToStorey` resolves a malformed
    // file naming the same element in more than one `IfcRelContainedInSpatialStructure`
    // edge (two different storeys both containing the same wall) to the
    // FIRST-declared edge, matching `packages/query`'s `containedIn()`. Before
    // this fix, `element_to_storey` here just pushed every matching relation
    // pair in file order with no winner picked at this layer at all - the
    // Parquet lookup table then carried BOTH `(element, StoreyA)` and
    // `(element, StoreyB)` rows, and `packages/server-client`'s
    // `data-model-decoder.ts` flattens that table into a `Map` with a plain
    // forward `for` loop and unconditional `map.set`, so the LAST row in file
    // order silently won - the opposite of the ruling. Deduping to the
    // first-declared row here, before serialization, makes that flattening
    // step correct regardless of its own iteration order and keeps this one
    // lookup table consistent with the wasm/parser path's `elementToStorey`.
    //
    // Only storeys reachable from IfcProject compete for the first-declared
    // slot - packages/parser never visits a rescued orphan storey, so an
    // orphan declared before a reachable storey must not claim the element
    // there either. An element contained ONLY in orphan storeys still keeps
    // its first-declared orphan row (the orphan is a rescued root here, and
    // dropping the row would lose data the parser has no equivalent for).
    let mut storey_claimed: FxHashSet<u32> = FxHashSet::default();
    let mut orphan_storey_claimed: FxHashSet<u32> = FxHashSet::default();
    let mut element_to_orphan_storey: Vec<(u32, u32)> = Vec::new();

    for rel in relationships {
        if cancel.is_cancelled() { break; }
        if rel.rel_type.to_uppercase() == "IFCRELCONTAINEDINSPATIALSTRUCTURE" {
            let spatial_id = rel.relating_id;
            let element_id = rel.related_id;

            // Skip a target that was promoted to a spatial-structure node above: it is
            // not a leaf element, so it has no place in these element_to_* lookups
            // (mirrors containedElements excluding containedSpatialChildren in
            // packages/parser/src/spatial-hierarchy-builder.ts).
            let target_is_spatial = entity_map
                .get(&element_id)
                .map(|e| {
                    let target_type_upper = e.type_name.to_uppercase();
                    (predicates.spatial)(&target_type_upper) && target_type_upper != "IFCPROJECT"
                })
                .unwrap_or(false);
            if target_is_spatial {
                continue;
            }

            if let Some(spatial_node) = nodes_map.get(&spatial_id) {
                let type_upper = spatial_node.type_name.to_uppercase();
                if type_upper == "IFCBUILDINGSTOREY" {
                    // First-declared wins: an element already claimed by an
                    // earlier-declared storey ignores every later-declared one.
                    if !project_reachable.contains(&spatial_id) {
                        if orphan_storey_claimed.insert(element_id) {
                            element_to_orphan_storey.push((element_id, spatial_id));
                        }
                    } else if storey_claimed.insert(element_id) {
                        element_to_storey.push((element_id, spatial_id));
                    }
                } else if (predicates.building)(&type_upper) {
                    element_to_building.push((element_id, spatial_id));
                } else if type_upper == "IFCSITE" {
                    element_to_site.push((element_id, spatial_id));
                } else if (predicates.space)(&type_upper) {
                    element_to_space.push((element_id, spatial_id));
                }
            }
        }
    }

    // Orphan-only elements keep their first-declared orphan storey.
    for (element_id, spatial_id) in element_to_orphan_storey {
        if cancel.is_cancelled() { break; }
        if !storey_claimed.contains(&element_id) {
            element_to_storey.push((element_id, spatial_id));
        }
    }

    ElementLookups {
        storey: element_to_storey,
        building: element_to_building,
        site: element_to_site,
        space: element_to_space,
    }
}

/// Canonical spatial categories shared by hierarchy promotion and lookups.
pub(super) fn predicates() -> SpatialPredicates {
    // Types treated as spatial-structure nodes, mirroring
    // packages/data/src/spatial-types.ts's SPATIAL_STRUCTURE_TYPE_ENUMS. IFCSPATIALZONE,
    // IFCMARINEPART and IFCFACILITYPARTCOMMON were missing here (#3965): the TS side has
    // carried them since #1075 (IfcSpatialZone) and #3248/#3249 (the IFC4X3 pair), so an
    // aggregated instance of any of the three already built a node via
    // build_spatial_nodes_recursive's blind children_ids walk - only the orphan-fill loop
    // below and the containment promotion added by #3965 depend on this list.
    let is_spatial_type = |type_name: &str| {
        matches!(
            type_name.to_uppercase().as_str(),
            "IFCPROJECT"
                | "IFCSITE"
                | "IFCBUILDING"
                | "IFCBUILDINGSTOREY"
                | "IFCSPACE"
                | "IFCSPATIALZONE"
                | "IFCFACILITY"
                | "IFCFACILITYPART"
                | "IFCFACILITYPARTCOMMON"
                | "IFCBRIDGE"
                | "IFCBRIDGEPART"
                | "IFCROAD"
                | "IFCROADPART"
                | "IFCRAILWAY"
                | "IFCRAILWAYPART"
                | "IFCMARINEFACILITY"
                | "IFCMARINEPART"
        )
    };
    let is_building_like_spatial_type = |type_name: &str| {
        matches!(
            type_name.to_uppercase().as_str(),
            "IFCBUILDING"
                | "IFCFACILITY"
                | "IFCBRIDGE"
                | "IFCROAD"
                | "IFCRAILWAY"
                | "IFCMARINEFACILITY"
        )
    };
    // Space-like: bucket into element_to_space, mirroring
    // packages/data/src/spatial-types.ts's isSpaceLikeSpatialType (IfcSpace and
    // IfcSpatialZone roll their contained elements up the same way there).
    let is_space_like_spatial_type =
        |type_upper: &str| matches!(type_upper, "IFCSPACE" | "IFCSPATIALZONE");

    SpatialPredicates { spatial: is_spatial_type, building: is_building_like_spatial_type, space: is_space_like_spatial_type }
}
