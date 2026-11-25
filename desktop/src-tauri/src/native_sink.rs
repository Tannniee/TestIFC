// SPDX-License-Identifier: MPL-2.0
//! Desktop packet callbacks on the canonical request/event processing API.
use ifc_lite_processing::{FrameEvent, ProcessingSink};
use ifc_lite_processing::MeshData;
use std::sync::OnceLock;

pub(crate) struct NativeSink<'a, B, C> {
    basis: &'a OnceLock<[f64; 16]>,
    batches: B,
    colors: C,
}

impl<'a, B, C> NativeSink<'a, B, C>
where B: FnMut(&[MeshData], usize, usize), C: FnMut(&[(u32, [f32; 4])]) {
    pub fn new(basis: &'a OnceLock<[f64; 16]>, batches: B, colors: C) -> Self {
        Self { basis, batches, colors }
    }
}

impl<B, C> ProcessingSink for NativeSink<'_, B, C>
where B: FnMut(&[MeshData], usize, usize), C: FnMut(&[(u32, [f32; 4])]) {
    fn on_frame(&mut self, frame: &FrameEvent) {
        self.basis.set(frame.baked_basis).expect("A native processing pass publishes one frame");
    }
    fn on_batch(&mut self, meshes: &[MeshData], processed: usize, total: usize) {
        (self.batches)(meshes, processed, total);
    }
    fn on_color_update(&mut self, updates: &[(u32, [f32; 4])]) {
        (self.colors)(updates);
    }
}
