// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Compile the canonical semantic extractor, without the HTTP server or Arrow.
// Preserve its module namespace; there is no desktop copy to drift from it.
#[path = "../../../apps/server/src/services/data_model/mod.rs"]
pub mod data_model;
