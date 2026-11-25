// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! An authored finite solid can contain a real positive gap inside the import
//! reconciliation band. Preserve that gap without changing imported flush faces.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SurfacePolicy {
    ImportReconciled,
    SourceStrict,
}

impl SurfacePolicy {
    pub(crate) fn reconcile(self) -> bool {
        self == Self::ImportReconciled
    }
}
