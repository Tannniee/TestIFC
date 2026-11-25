// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Evaluate manufacturing subtraction features in the stock's authored frame,
//! before any world rotation or translation narrows vertices to f32. This is a
//! rigid coordinate change; genuinely oblique and blind cutters stay 3D.
//! Ordinary IfcOpeningElement routing and native global frame defaults stay as
//! configured. Refused candidates leave no diagnostics, memo or route telemetry.
use super::{bool2d_path::context_precision, precision_seams, GeometryRouter};
use crate::{Mesh, Result, SubMeshCollection, Vector3, Point3};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
use nalgebra::Matrix4;
use rustc_hash::FxHashMap;
use std::ops::{Deref,DerefMut};

pub(super) trait Output {
    fn meshes(&mut self) -> Vec<&mut Mesh>;
}

#[cfg(test)]
#[path="source_frame_tests.rs"]
mod tests;
impl Output for Vec<Mesh> {
    fn meshes(&mut self) -> Vec<&mut Mesh> { self.iter_mut().collect() }
}
impl Output for SubMeshCollection {
    fn meshes(&mut self) -> Vec<&mut Mesh> { self.sub_meshes.iter_mut().map(|s|&mut s.mesh).collect() }
}

/// Keep the speculative placement memo isolated, including any descendant
/// placements the attempt lazily resolves. Drop restores it even on unwind.
struct MemoScope<'a,'data> {
    decoder: &'a mut EntityDecoder<'data>,
    saved: Option<FxHashMap<u32,[f64;16]>>,
}
impl<'a,'data> MemoScope<'a,'data> {
    fn new(decoder: &'a mut EntityDecoder<'data>, cache: FxHashMap<u32,[f64;16]>) -> Self {
        let saved=decoder.take_placement_transform_cache();
        decoder.set_placement_transform_cache(cache);
        Self { decoder, saved:Some(saved) }
    }
}
impl<'data> Deref for MemoScope<'_,'data> {
    type Target=EntityDecoder<'data>;
    fn deref(&self)->&Self::Target { self.decoder }
}
impl DerefMut for MemoScope<'_,'_> {
    fn deref_mut(&mut self)->&mut Self::Target { self.decoder }
}
impl Drop for MemoScope<'_,'_> {
    fn drop(&mut self) { self.decoder.set_placement_transform_cache(self.saved.take().expect("owned placement memo")); }
}

impl GeometryRouter {
    fn source_frame_plan(&self, element:&DecodedEntity, ids:&[u32], decoder:&mut EntityDecoder)
        ->Option<(Matrix4<f64>,FxHashMap<u32,[f64;16]>,f64)> {
        if self.source_frame_active || self.preserve_triangle_order.get() || ids.len()>10_000 { return None; }
        // Layer slicing keeps its established per-material orchestration.
        if self.material_layer_index.as_ref().and_then(|index|index.get(element.id)).is_some_and(|b|b.is_sliceable()) { return None; }
        let mut products=Vec::with_capacity(ids.len()+1);
        products.push(element.clone());
        let mut manufacturing=false;
        for &id in ids {
            let opening=decoder.decode_by_id(id).ok()?;
            manufacturing |= opening.ifc_type.is_subtype_of(IfcType::IfcFeatureElementSubtraction)
                && !opening.ifc_type.is_subtype_of(IfcType::IfcOpeningElement)
                && self.body_representation_items(&opening,decoder).is_some_and(|items|!items.is_empty());
            products.push(opening);
        }
        if !manufacturing { return None; }
        let precision=context_precision(element,decoder,self.unit_scale)?;
        if precision*0.25 < crate::kernel::mesh_bridge::SNAP_GRID { return None; }
        let host=self.host_extruded_solid(element,decoder)?;
        if host.profile.outer.iter().chain(host.profile.holes.iter().flatten())
            .any(|p| !p.x.is_finite() || !p.y.is_finite() || p.coords.norm()*self.unit_scale>1000.) { return None; }
        let frame=host.m;
        let rotation=frame.fixed_view::<3,3>(0,0);
        if !frame.iter().all(|v|v.is_finite()) || (rotation.transpose()*rotation-nalgebra::Matrix3::identity()).amax()>1e-9
            || rotation.determinant()<0.0 { return None; }
        let inverse=frame.try_inverse()?;
        let mut cache=FxHashMap::default();
        for product in products {
            let placement=product.get_ref(5)?;
            let (world,truncated)=self.get_placement_transform_from_element_with_status(&product,decoder).ok()?;
            if truncated || !world.iter().all(|v|v.is_finite()) { return None; }
            let transformed=inverse*world;
            cache.insert(placement,*transformed.as_slice().first_chunk::<16>()?);
        }
        Some((frame,cache,precision))
    }

    fn precision_router(&self, precision:f64,exact:bool)->Self {
        let mut router=Self::with_scale_and_quality(self.unit_scale,self.tessellation_quality);
        // The stock's authored frame IS the small computation frame. A second
        // AABB-centre rebase would move its planes onto a different kernel grid.
        router.local_frame_enabled=Some(true);
        router.precision_frame=exact.then_some(precision);
        if exact {
            router.processors.insert(IfcType::IfcExtrudedAreaSolid,std::rc::Rc::new(
                crate::processors::ExtrudedAreaSolidProcessor::with_profile_chord_tolerance(
                    self.schema.clone(),precision*0.25/self.unit_scale)));
        }
        router.source_frame_active=true;
        router.set_skip_small_cuts(self.skip_small_cuts);
        // A refined profile is a different mesh from the ordinary import at
        // the same quality enum. Keep its caches local to this precision scope.
        if !exact {
            router.shared_mapped_item_cache=self.shared_mapped_item_cache.clone();
            router.item_dedup_cache=self.item_dedup_cache.clone();
            router.shared_brep_signatures=self.shared_brep_signatures.clone();
        }
        router.material_layer_index=self.material_layer_index.clone();
        router.indexed_colour_split_ids=self.indexed_colour_split_ids.clone();
        router.preserve_triangle_order.set(self.preserve_triangle_order.get());
        router
    }

    pub(super) fn try_source_frame<'data,T:Output>(
        &self, element:&DecodedEntity, decoder:&mut EntityDecoder<'data>,
        void_index:&FxHashMap<u32,Vec<u32>>,
        mut evaluate:impl FnMut(&GeometryRouter,&mut EntityDecoder<'data>)->Result<T>,
    )->Option<T> {
        if !self.source_frame_active {self.source_boundary_verdict.set(None);}
        let ids=void_index.get(&element.id).filter(|v|!v.is_empty())?;
        let (frame,cache,precision)=self.source_frame_plan(element,ids,decoder)?;
        'attempt: for exact in [true,false] {
        let transaction=crate::telemetry_transaction::Transaction::new();
        let _budget=crate::kernel::budget::enter_element();
        let local=self.precision_router(precision,exact);
        let mut output={
            let mut scope=MemoScope::new(decoder,cache.clone());
            let Ok(mut output)=evaluate(&local,&mut scope) else {continue 'attempt;};
            if !local.csg_failures.borrow().is_empty() || !local.take_unsupported_items().is_empty(){continue 'attempt;}
            for mesh in output.meshes(){
                if mesh.is_empty() && local.host_consumed_by_void(element.id){continue;}
                super::source_hygiene::clean(mesh);
                if !precision_seams::close_with_precision(mesh,precision){continue 'attempt;}
            }
            if !exact && !super::source_validation::excludes_cutters(&local,element,ids,&mut output,&mut scope,precision){continue 'attempt;}
            output
        };
        let mut count=0;
        let mut boundary_components=0_u32;
        let mut triangles=0;
        let mut bounds=([f64::INFINITY;3],[f64::NEG_INFINITY;3]);
        for mesh in output.meshes() {
            if mesh.is_empty() && local.host_consumed_by_void(element.id){continue;}
            count+=1;
            super::source_hygiene::clean(mesh);
            if !precision_seams::close_with_precision(mesh,precision) {continue 'attempt;}
            self.restore_precision_mesh(mesh,&frame);
            super::source_hygiene::clean(mesh);
            if !precision_seams::close_with_precision(mesh,precision) {continue 'attempt;}
            let Some(verdict)=precision_seams::boundary_verdict(mesh) else {continue 'attempt;};
            let Some(total)=boundary_components.checked_add(verdict.components) else {continue 'attempt;};
            boundary_components=total;
            triangles+=mesh.triangle_count();
            for p in mesh.positions.as_chunks::<3>().0 { for i in 0..3 {
                let coordinate=f64::from(p[i])+mesh.origin[i];
                bounds.0[i]=bounds.0[i].min(coordinate); bounds.1[i]=bounds.1[i].max(coordinate);
            }}
        }
        if count==0 && !local.host_consumed_by_void(element.id) {continue 'attempt;}
        if let Some(diag)=local.host_opening_diagnostics.borrow_mut().get_mut(&element.id) {
            diag.tris_after=Some(triangles);
            if count>0 { diag.host_bounds=Some(((bounds.0[0] as f32,bounds.0[1] as f32,bounds.0[2] as f32),
                (bounds.1[0] as f32,bounds.1[1] as f32,bounds.1[2] as f32))); }
        }
        self.accept_precision_diagnostics(&local);
        self.source_boundary_verdict.set(Some((element.id,crate::OrientVerdict {
            flipped:false,all_closed:true,all_orientable:true,components:boundary_components,
        })));
        transaction.commit();
        return Some(output);
        }
        None
    }

    /// Consume the exact finite-boundary proof produced by this router's last
    /// authored-frame cut. Callers preserve its winding and finite faces rather
    /// than re-welding thin cavities through the import orientation heuristic.
    pub fn take_source_boundary_verdict(&self,id:u32)->Option<crate::OrientVerdict> {
        self.source_boundary_verdict.take().and_then(|(host,verdict)|(host==id).then_some(verdict))
    }

    fn restore_precision_mesh(&self,mesh:&mut Mesh,frame:&Matrix4<f64>) {
        let rotation=frame.fixed_view::<3,3>(0,0);
        let mut world=*frame;
        for i in 0..3 { world[(i,3)]*=self.unit_scale; }
        let origin=world.transform_point(&Point3::from(mesh.origin));
        // Centre AFTER the f64 rotation, before narrowing. A source-frame
        // centre need not minimise the rotated f32 coordinates of an asymmetric
        // profile; an avoidable exponent increase can collapse a real seam.
        let mut lo=Vector3::repeat(f64::INFINITY);let mut hi=Vector3::repeat(f64::NEG_INFINITY);
        for p in mesh.positions.as_chunks::<3>().0 {
            let v=rotation*Vector3::new(f64::from(p[0]),f64::from(p[1]),f64::from(p[2]));
            for i in 0..3 {lo[i]=lo[i].min(v[i]);hi[i]=hi[i].max(v[i]);}
        }
        let centre=if mesh.positions.is_empty(){Vector3::zeros()}else{(lo+hi)*0.5};
        mesh.origin=[origin.x+centre.x-self.rtc_offset.0,origin.y+centre.y-self.rtc_offset.1,origin.z+centre.z-self.rtc_offset.2];
        for p in mesh.positions.as_chunks_mut::<3>().0 {
            let v=rotation*Vector3::new(f64::from(p[0]),f64::from(p[1]),f64::from(p[2]))-centre;
            *p=[v.x as f32,v.y as f32,v.z as f32];
        }
        for p in mesh.normals.as_chunks_mut::<3>().0 {
            let v=rotation*Vector3::new(f64::from(p[0]),f64::from(p[1]),f64::from(p[2]));
            *p=[v.x as f32,v.y as f32,v.z as f32];
        }
        if let Some(matrix)=mesh.local_to_world {
            let restored=world*Matrix4::from_row_slice(&matrix);
            mesh.local_to_world=Some(crate::router::transforms::mat4_to_row_major(&restored));
        }
        mesh.instance_meta=None; mesh.plane_tags=None; mesh.rtc_applied=true;
    }

    fn accept_precision_diagnostics(&self,local:&GeometryRouter) {
        let classified=local.take_classification_stats();
        let mut counts=self.classification_stats.borrow_mut();
        counts.rectangular+=classified.rectangular; counts.diagonal+=classified.diagonal; counts.non_rectangular+=classified.non_rectangular;
        self.host_opening_diagnostics.borrow_mut().extend(local.take_host_opening_diagnostics());
        self.voids_consumed_hosts.borrow_mut().extend(local.voids_consumed_hosts.borrow().iter().copied());
        let fast=local.take_rect_fast_stats();
        let mut total=self.rect_fast_stats.borrow_mut();
        total.fired+=fast.fired; total.openings_cut+=fast.openings_cut;
        total.defer_host_not_box+=fast.defer_host_not_box; total.defer_not_through+=fast.defer_not_through;
        total.defer_off_face+=fast.defer_off_face; total.defer_near_edge+=fast.defer_near_edge;
        total.defer_no_openings+=fast.defer_no_openings; total.defer_too_many_openings+=fast.defer_too_many_openings;
    }
}
