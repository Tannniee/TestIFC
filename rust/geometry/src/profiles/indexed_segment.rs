// SPDX-License-Identifier: MPL-2.0
use ifc_lite_core::AttributeValue;

/// One `IfcIndexedPolyCurve` segment, `IFCLINEINDEX((i1,i2,...))` or
/// `IFCARCINDEX((i1,i2,i3))`: whether it is an arc and its index list. A bare
/// index list reads as a line; anything else has no indices.
pub(crate) fn indexed_segment(segment: &AttributeValue) -> (bool, Option<&[AttributeValue]>) {
    match segment {
        AttributeValue::Typed { name, value } => match &**value {
            AttributeValue::List(indices) => (name.contains("ARC"), Some(indices)),
            other => (false, Some(std::slice::from_ref(other))),
        },
        AttributeValue::List(indices) => (false, Some(indices)),
        _ => (false, None),
    }
}
