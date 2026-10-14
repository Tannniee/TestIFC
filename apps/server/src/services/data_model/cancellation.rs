// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Cooperative extraction cancellation; cancelled partial rows never leave the service.
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtractionCancelled;
impl std::fmt::Display for ExtractionCancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Native IFC job cancelled")
    }
}
impl std::error::Error for ExtractionCancelled {}

#[derive(Clone, Copy)]
pub(super) struct Cancellation<'a>(pub Option<&'a AtomicBool>);
impl Cancellation<'_> {
    pub fn is_cancelled(self) -> bool {
        self.0.is_some_and(|token| token.load(Ordering::Acquire))
    }
    pub fn check(self) -> Result<(), ExtractionCancelled> {
        if self.is_cancelled() { Err(ExtractionCancelled) } else { Ok(()) }
    }
}
