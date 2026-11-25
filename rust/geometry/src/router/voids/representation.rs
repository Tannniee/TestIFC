// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Conservative, geometry-free routing for documented Reference openings.
use crate::GeometryRouter;
use crate::diag::diag_debug;
use ifc_lite_core::{EntityDecoder, DecodedEntity};

impl GeometryRouter {
    pub(super) fn classify_openings_quiet(&self, element: &DecodedEntity, ids: &[u32], decoder: &mut EntityDecoder) -> Vec<super::CutterKind> {
        match crate::program::openings::OpeningControl::classifier(element, ids, false).drain(self, decoder) {
            Ok(crate::program::openings::OpeningOutput::Classified(openings)) => openings,
            Ok(_) => Vec::new(),
            Err(error) => { diag_debug!({ "Quiet opening classification refused: {error}" } else { eprintln!("Quiet opening classification refused: {error}"); }); Vec::new() }
        }
    }

    /// Whether an opening must retain the canonical cutter path. Only a proven
    /// Reference-only opening (optionally with BoundingBox) returns false.
    /// Unknown, malformed, empty and over-budget representation data returns true
    /// so ordinary cutter/error handling remains authoritative (#4440).
    pub fn opening_requires_subtraction(&self, id: u32, decoder: &mut EntityDecoder<'_>) -> bool {
        crate::representation::structural::reference_only_opening(id, decoder) != Some(true)
    }
}
