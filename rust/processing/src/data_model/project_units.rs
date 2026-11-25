// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Native display-unit transport; resolution stays in ifc_lite_core.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayUnit {
    pub symbol: String,
    pub si_scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUnitAssignment {
    pub by_type: std::collections::BTreeMap<String, Option<DisplayUnit>>,
    pub monetary: Option<DisplayUnit>,
}

impl From<ifc_lite_core::project_units::ProjectUnits> for ProjectUnitAssignment {
    fn from(units: ifc_lite_core::project_units::ProjectUnits) -> Self {
        let wire = |unit: &ifc_lite_core::project_units::ResolvedUnit| DisplayUnit {
            symbol: unit.symbol.clone(), si_scale: unit.si_scale,
        };
        Self { by_type: units.declarations().map(|(token, unit)|
            (token.to_owned(), unit.map(wire))).collect(), monetary: units.monetary().map(wire) }
    }
}

