// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Bounded, cutter-only retry for grazing the stock's boundary planes.
use crate::Mesh;
pub(super) fn has_resolvable_skin(stock:&Mesh,cutter:&Mesh)->bool {
    let (lo,hi)=stock.bounds();let (clo,chi)=cutter.bounds();let grid=crate::kernel::mesh_bridge::SNAP_GRID;
    (0..3).any(|i|[f64::from(clo[i])+cutter.origin[i]-f64::from(lo[i])-stock.origin[i],
        f64::from(hi[i])+stock.origin[i]-f64::from(chi[i])-cutter.origin[i]]
        .iter().any(|delta|*delta>grid && *delta<8.*grid))
}
pub(super) fn scaled(mesh:&Mesh,factor:f64)->Mesh {
    let mut result=mesh.clone();
    for coordinate in &mut result.positions{*coordinate=(f64::from(*coordinate)*factor) as f32;}
    result.origin=result.origin.map(|v|v*factor);result.plane_tags=None;result.instance_meta=None;result.local_to_world=None;result
}
pub(super) fn translated(mesh:&Mesh,delta:[f64;3])->Mesh {
    let mut result=mesh.clone();
    for p in result.positions.as_chunks_mut::<3>().0 {
        for i in 0..3 {p[i]=(f64::from(p[i])+delta[i]) as f32;}
    }
    result.plane_tags=None;result.instance_meta=None;result.local_to_world=None;
    result
}
pub(super) fn cutter_at_precision(cutter:&Mesh,stock:&Mesh,precision:f64,clearance:f64)->Option<Mesh> {
    if !precision.is_finite() || precision<=0. {return None;}
    let (lo,hi)=stock.bounds();let mut result=cutter.clone();let mut changed=false;
    for p in result.positions.as_chunks_mut::<3>().0 {
        let original=*p;
        for axis in 0..3 {
            for (boundary,sign) in [(lo[axis],-1.),(hi[axis],1.)] {
                let distance=(f64::from(p[axis])-f64::from(boundary))*sign;
                let delta=clearance*crate::kernel::mesh_bridge::SNAP_GRID-distance;
                if distance<=0. && distance>=-crate::kernel::mesh_bridge::SNAP_GRID && delta>0. && delta<=precision {
                    let mut moved=*p;moved[axis]=(f64::from(p[axis])+delta*sign) as f32;
                    let displacement=original.iter().zip(moved).map(|(a,b)|(f64::from(*a)-f64::from(b)).powi(2)).sum::<f64>();
                    if displacement<=precision*precision {*p=moved;changed=true;}
                }
            }
        }
    }
    if !changed {return None;}
    result.plane_tags=None;crate::calculate_normals(&mut result);Some(result)
}
