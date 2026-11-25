// SPDX-License-Identifier: MPL-2.0
use super::{source::{refs, Source}, ColorizerRequest};
use crate::{LogMutation, LogNewEntity, MutationKind, MutationLog};
use ifc_lite_core::{AttributeValue as A, IfcType};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

fn wire(source: &mut Source<'_>, value: &A, depth: usize) -> Result<Value,String> {
    source.charge()?;
    if depth > 64 { return Err("Colorizer attribute nesting budget exceeded".into()); }
    Ok(match value {
        A::Null => Value::Null, A::Derived => json!("*"),
        A::EntityRef(id) => json!(format!("#{id}")),
        A::String(s) => json!(s), A::Enum(s) => json!(format!(".{s}.")),
        A::Integer(n) => json!(n), A::Float(n) if n.is_finite() => json!({"real":n}),
        A::Float(_) => return Err("Non-finite IFC geometry attribute".into()),
        A::List(values) => match values.as_slice() {
            [A::String(ty), inner] if ty.starts_with("IFC") && !matches!(inner, A::List(_)) =>
                json!({"typed":{"type":ty,"value":wire(source,inner,depth+1)?}}),
            _ => Value::Array(values.iter().map(|v| wire(source,v,depth+1)).collect::<Result<_,_>>()?),
        }
    })
}

struct Painter<'a> {
    source: Source<'a>, log: MutationLog,
    owners: BTreeMap<u32,BTreeSet<Option<usize>>>,
    variants: BTreeMap<(u32,usize),u32>, styles: BTreeMap<usize,u32>,
    colors: Vec<[f64;4]>, removed: BTreeSet<u32>,
}

impl Painter<'_> {
    fn add(&mut self, name: &str, attributes: Vec<Value>) -> Result<u32,String> {
        self.source.charge()?;
        let id = self.source.next_id;
        self.source.next_id = id.checked_add(1).ok_or("Colorizer express id capacity exceeded")?;
        self.log.new_entities.push(LogNewEntity::new(id,name,attributes));
        self.log.mutations.push(LogMutation::new(MutationKind::CreateEntity,id));
        Ok(id)
    }

    fn edit(&mut self, id: u32, index: usize, value: Value) {
        let mut mutation = LogMutation::new(MutationKind::UpdatePositionalAttribute,id);
        mutation.attribute_name = Some(format!("@{index}"));
        mutation.new_value = Some(value);
        self.log.mutations.push(mutation);
    }

    fn remove(&mut self, id: u32) {
        if self.removed.insert(id) { self.log.mutations.push(LogMutation::new(MutationKind::DeleteEntity,id)); }
    }

    fn style(&mut self, color: usize) -> Result<u32,String> {
        if let Some(&id) = self.styles.get(&color) { return Ok(id); }
        let [r,g,b,a] = self.colors[color];
        let rgb = self.add("IfcColourRgb",vec![Value::Null,json!({"real":r}),json!({"real":g}),json!({"real":b})])?;
        // Rendering carries Transparency in IFC2X3 too; Shading does not.
        let rendering = self.add("IfcSurfaceStyleRendering",vec![json!(format!("#{rgb}")),json!({"real":1.-a}),
            Value::Null,Value::Null,Value::Null,Value::Null,Value::Null,Value::Null,json!(".NOTDEFINED.")])?;
        let style = self.add("IfcSurfaceStyle",vec![json!("Colorizer"),json!(".BOTH."),json!([format!("#{rendering}")])])?;
        self.styles.insert(color,style);
        Ok(style)
    }

    fn surface_style(&mut self, original: u32, target: u32, color: usize) -> Result<(),String> {
        let styled = self.source.styled.get(&original).cloned().unwrap_or_default();
        let mut kept = BTreeSet::new();
        for id in styled {
            let entity = self.source.entity(id)?;
            for style in refs(entity.get(1)) {
                let style_entity = self.source.entity(style)?;
                let candidates = if self.source.rows[&style] == "IFCPRESENTATIONSTYLEASSIGNMENT" { refs(style_entity.get(0)) } else { vec![style] };
                for candidate in candidates {
                    if self.source.entity(candidate)?.ifc_type != IfcType::IfcSurfaceStyle { kept.insert(candidate); }
                }
            }
            if original == target { self.remove(id); }
        }
        if original == target {
            // Inverse maps target this exact geometry item. Cloned variants do
            // not inherit them; recolouring the original detaches only its maps.
            for id in self.source.maps.get(&original).cloned().unwrap_or_default() { self.remove(id); }
        }
        kept.insert(self.style(color)?);
        let styles: Vec<_> = kept.into_iter().map(|id| json!(format!("#{id}"))).collect();
        let styles = if self.source.schema == "IFC2X3" {
            let assignment = self.add("IfcPresentationStyleAssignment",vec![Value::Array(styles)])?;
            vec![json!(format!("#{assignment}"))]
        } else { styles };
        self.add("IfcStyledItem",vec![json!(format!("#{target}")),Value::Array(styles),Value::Null])?;
        Ok(())
    }

    fn variant(&mut self, id: u32, color: usize) -> Result<u32,String> {
        // Source::nodes validates cycles and supplies a postorder. No recursive
        // file-reference traversal or depth-only cycle cap is needed here.
        for node in self.source.nodes(id)? {
            if self.variants.contains_key(&(node,color)) { continue; }
            let terminal = self.source.terminal(node)?;
            let children = self.source.children(node)?;
            let changed_children: BTreeMap<_,_> = children.iter().filter_map(|child|
                self.variants.get(&(*child,color)).copied().filter(|next| next != child).map(|next| (*child,next))).collect();
            if !terminal && changed_children.is_empty() {
                self.variants.insert((node,color),node);
                continue;
            }
            let entity = self.source.entity(node)?;
            let mut attributes: Vec<_> = entity.attributes.iter().map(|value| wire(&mut self.source,value,0)).collect::<Result<_,_>>()?;
            let slot = match entity.ifc_type { IfcType::IfcProductDefinitionShape => Some(2), IfcType::IfcShapeRepresentation => Some(3),
                IfcType::IfcRepresentationMap => Some(1), IfcType::IfcMappedItem | IfcType::IfcGeometricSet => Some(0), _ => None };
            if let Some(slot) = slot {
                let remap = |value: &mut Value| {
                    if let Some(id) = value.as_str().and_then(|s| s.strip_prefix('#')).and_then(|s| s.parse::<u32>().ok()) {
                        if let Some(next) = changed_children.get(&id) { *value = json!(format!("#{next}")); }
                    }
                };
                match &mut attributes[slot] { Value::Array(values) => values.iter_mut().for_each(remap), value => remap(value) }
            }
            let original_color = self.owners.get(&node).and_then(|owners| owners.first()).copied().flatten();
            let target = if original_color == Some(color) {
                if let Some(slot) = slot { if !changed_children.is_empty() { self.edit(node,slot,attributes[slot].clone()); } }
                node
            } else { self.add(entity.ifc_type.name(),attributes)? };
            self.variants.insert((node,color),target);
            if terminal { self.surface_style(node,target,color)?; }
        }
        self.variants.get(&(id,color)).copied().ok_or_else(|| "Missing recoloured representation".into())
    }
}

pub fn plan_colorizer(bytes: &[u8], request: &ColorizerRequest) -> Result<MutationLog,String> {
    let mut source = Source::new(bytes)?;
    let products = source.surface_products()?;
    let mut selected = BTreeMap::new();
    let mut colors = Vec::new();
    for batch in &request.batches {
        if batch.color.iter().any(|v| !v.is_finite() || !(0.0..=1.0).contains(v)) { return Err("Colour channels must be finite values in 0..1".into()); }
        let key = colors.iter().position(|color| color == &batch.color).unwrap_or_else(|| { colors.push(batch.color); colors.len()-1 });
        for &product in &batch.products {
            if !products.contains_key(&product) { return Err(format!("IFC object #{product} has no supported 3D surface")); }
            if selected.insert(product,key).is_some() { return Err("A product occurs in more than one colour batch".into()); }
        }
    }
    let mut owners: BTreeMap<_,BTreeSet<_>> = BTreeMap::new();
    for (&product,nodes) in &products {
        for &node in nodes { owners.entry(node).or_default().insert(selected.get(&product).copied()); }
    }
    let mut painter = Painter { source, log: MutationLog::default(), owners, variants: BTreeMap::new(),
        styles: BTreeMap::new(), colors, removed: BTreeSet::new() };
    for (product,color) in selected {
        let root = painter.source.products[&product];
        let target = painter.variant(root,color)?;
        if root != target { painter.edit(product,6,json!(format!("#{target}"))); }
    }
    Ok(painter.log)
}
