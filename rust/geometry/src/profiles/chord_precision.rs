// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Explicit, router-local physical chord bound. Default import density stays
//! unchanged; a finite-source caller may require a finer bounded polygon.
use super::{ProfileProcessor,IfcSchema,TessellationQuality,Cell,MAX_CURVE_NODES};
use crate::{Error,Result};

impl ProfileProcessor {
    /// Create a processor with the engine's ordinary profile density.
    pub fn new(schema:IfcSchema)->Self {
        Self {schema,active_quality:Cell::new(TessellationQuality::Medium),
            chord_tolerance:None,curve_budget:Cell::new(MAX_CURVE_NODES),
            region_budget:super::regions::WorkBudget::new(super::regions::MAX_PROFILE_REGIONS),
            point_budget:super::regions::WorkBudget::new(super::regions::MAX_PROFILE_POINTS)}
    }
    pub(crate) fn with_chord_tolerance(schema:IfcSchema,tolerance:f64)->Self {
        Self {chord_tolerance:Some(tolerance),..Self::new(schema)}
    }
    #[inline]
    pub(super) fn quality(&self)->TessellationQuality {self.active_quality.get()}

    pub(super) fn bounded_arc_segments(&self,radius:f64,sweep:f64,base:usize)->Result<usize> {
        let Some(tolerance)=self.chord_tolerance else{return Ok(base);};
        if !tolerance.is_finite() || tolerance<=0. || !radius.is_finite() || !sweep.is_finite(){
            return Err(Error::geometry("Invalid finite-profile chord bound"));
        }
        let radius=radius.abs();
        if radius<=tolerance{return Ok(base);}
        let step=2.*(1.-tolerance/radius).clamp(-1.,1.).acos();
        let needed=(sweep.abs()/step).ceil();
        if !needed.is_finite() || needed>4096. {
            return Err(Error::geometry("Finite-profile chord bound exceeds 4096 segments"));
        }
        let refined=base.max(needed as usize);
        self.spend_refinement(refined-base)?;
        Ok(refined)
    }
    fn spend_refinement(&self,extra:usize)->Result<()> {
        let extra=u32::try_from(extra).map_err(|_|Error::geometry("Finite-profile sample budget exceeded"))?;
        let remaining=self.curve_budget.get().checked_sub(extra)
            .ok_or_else(||Error::geometry("Finite-profile sample budget exceeded"))?;
        self.curve_budget.set(remaining);Ok(())
    }
    pub(super) fn bounded_circle_segments(&self,radius:f64,base:usize)->Result<usize> {
        let segments=self.bounded_arc_segments(radius,std::f64::consts::TAU,base)?;
        if self.chord_tolerance.is_none(){return Ok(segments);}
        // Parametric profiles are centred on their sampled bounds. Retain
        // opposite axis endpoints, so refinement cannot translate a circle.
        let symmetric=segments.div_ceil(4)*4;
        self.spend_refinement(symmetric-segments)?;
        Ok(symmetric)
    }
}
