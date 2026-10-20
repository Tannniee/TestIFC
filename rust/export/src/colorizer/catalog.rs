// SPDX-License-Identifier: MPL-2.0
use super::{source::{refs, Source}, ColorizerCatalog, ColorizerGroup, ColorizerGrouping, GroupBy};
use ifc_lite_core::{AttributeValue as A, IfcType};
use std::collections::{BTreeMap, BTreeSet};

fn text(value: Option<&A>) -> Option<String> {
    let value = match value? {
        A::String(s) | A::Enum(s) => s.clone(),
        A::Integer(n) => n.to_string(), A::Float(n) => n.to_string(),
        A::List(v) if v.len() == 2 && matches!(&v[0], A::String(_)) => return text(v.get(1)),
        _ => return None,
    };
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!value.is_empty() && value != "$" && value.len() <= 1024).then_some(value)
}

#[derive(Default)]
struct Relations {
    material: BTreeMap<u32, u32>, container: BTreeMap<u32, u32>,
    types: BTreeMap<u32, u32>, psets: BTreeMap<u32, Vec<u32>>,
}

impl Relations {
    fn load(source: &mut Source<'_>) -> Result<Self, String> {
        let rows: Vec<_> = source.rows.iter().filter(|(_, name)| matches!(name.as_str(),
            "IFCRELASSOCIATESMATERIAL" | "IFCRELDEFINESBYTYPE" | "IFCRELCONTAINEDINSPATIALSTRUCTURE" |
            "IFCRELDEFINESBYPROPERTIES" | "IFCRELAGGREGATES")).map(|(&id,_)| id).collect();
        let mut result = Self::default();
        for id in rows {
            let entity = source.entity(id)?;
            if entity.ifc_type == IfcType::IfcRelAggregates {
                if let Some(parent) = entity.get_ref(4) {
                    for child in refs(entity.get(5)) { result.container.entry(child).or_insert(parent); }
                }
                continue;
            }
            let Some(target) = entity.get_ref(5) else { continue; };
            for owner in refs(entity.get(4)) {
                match entity.ifc_type {
                    IfcType::IfcRelAssociatesMaterial => { result.material.insert(owner, target); }
                    IfcType::IfcRelDefinesByType => { result.types.insert(owner, target); }
                    IfcType::IfcRelContainedInSpatialStructure => { result.container.insert(owner, target); }
                    IfcType::IfcRelDefinesByProperties => { result.psets.entry(owner).or_default().push(target); }
                    _ => {}
                }
            }
        }
        Ok(result)
    }

    fn properties(&self, source: &mut Source<'_>, product: u32) -> Result<BTreeMap<String,String>, String> {
        let mut sets = self.psets.get(&product).cloned().unwrap_or_default();
        if let Some(ty) = self.types.get(&product) { sets.extend(refs(source.entity(*ty)?.get(5))); }
        let mut result = BTreeMap::new();
        // Type defaults first, occurrence properties override them.
        for id in sets.into_iter().rev() {
            let set = source.entity(id)?;
            if set.ifc_type != IfcType::IfcPropertySet { continue; }
            let Some(name) = set.get_string(2) else { continue; };
            for id in refs(set.get(4)) {
                let property = source.entity(id)?;
                if property.ifc_type != IfcType::IfcPropertySingleValue { continue; }
                if let (Some(key), Some(value)) = (property.get_string(0), text(property.get(2))) {
                    result.insert(format!("{name}.{key}"), value);
                }
            }
        }
        Ok(result)
    }
}

fn material_values(source: &mut Source<'_>, root: Option<u32>) -> Result<(Vec<String>,Vec<String>),String> {
    let (mut names, mut profiles) = (BTreeSet::new(), BTreeSet::new());
    let mut pending: Vec<_> = root.into_iter().collect();
    let mut visited = BTreeSet::new();
    while let Some(id) = pending.pop() {
        source.charge()?;
        if !visited.insert(id) { continue; }
        let entity = source.entity(id)?;
        if entity.ifc_type.is_subtype_of(IfcType::IfcProfileDef) {
            if let Some(name) = text(entity.get(1)) { profiles.insert(name); }
        } else if source.rows[&id].starts_with("IFCMATERIAL") {
            if entity.ifc_type == IfcType::IfcMaterial {
                if let Some(name) = text(entity.get(0)) { names.insert(name); }
            }
            let mut values: Vec<_> = entity.attributes.iter().collect();
            while let Some(value) = values.pop() {
                source.charge()?;
                match value { A::EntityRef(id) => pending.push(*id), A::List(v) => values.extend(v), _ => {} }
            }
        }
    }
    Ok((names.into_iter().collect(), profiles.into_iter().collect()))
}

fn geometry_profile(source: &mut Source<'_>, nodes: &[u32]) -> Result<Option<String>,String> {
    let mut pending = nodes.to_vec();
    let mut visited = BTreeSet::new();
    while let Some(id) = pending.pop() {
        source.charge()?;
        if !visited.insert(id) { continue; }
        let entity = source.entity(id)?;
        if entity.ifc_type.is_subtype_of(IfcType::IfcSweptAreaSolid) {
            if let Some(profile) = entity.get_ref(0) {
                if let Some(name) = text(source.entity(profile)?.get(1)) { return Ok(Some(name)); }
            }
        } else if matches!(entity.ifc_type, IfcType::IfcBooleanResult | IfcType::IfcBooleanClippingResult) {
            pending.extend([entity.get_ref(1),entity.get_ref(2)].into_iter().flatten());
        }
    }
    Ok(None)
}

pub fn catalog_colorizer(bytes: &[u8], grouping: &ColorizerGrouping) -> Result<ColorizerCatalog,String> {
    if matches!(grouping.mode, GroupBy::Property) && grouping.property.trim().is_empty() {
        return Err("Choose an attribute such as @Name or a Pset.Property".into());
    }
    let mut source = Source::new(bytes)?;
    let products = source.surface_products()?;
    let relations = Relations::load(&mut source)?;
    let mut groups: BTreeMap<String,ColorizerGroup> = BTreeMap::new();
    for (&id,nodes) in &products {
        let entity = source.entity(id)?;
        let props = if matches!(grouping.mode, GroupBy::Section | GroupBy::Property) { relations.properties(&mut source,id)? } else { BTreeMap::new() };
        let attribute_names = ifc_lite_core::attribute_names_for_schema(&source.schema,entity.ifc_type.name());
        let attribute = |key: &str| {
            if let Some(name) = key.strip_prefix('@') {
                attribute_names
                    .and_then(|names| names.iter().position(|candidate| *candidate == name))
                    .and_then(|slot| text(entity.get(slot)))
            } else { props.get(key).cloned() }
        };
        let material = relations.material.get(&id).or_else(|| relations.types.get(&id).and_then(|id| relations.material.get(id))).copied();
        let (names,profiles) = if matches!(grouping.mode, GroupBy::Material | GroupBy::Section) { material_values(&mut source,material)? } else { (Vec::new(),Vec::new()) };
        let type_name = if let Some(ty) = relations.types.get(&id) {
            let entity_type = source.entity(*ty)?;
            text(entity_type.get(8)).or_else(|| text(entity_type.get(2)))
        } else { None };
        let (name,origin) = match grouping.mode {
            GroupBy::Class => (entity.ifc_type.name().to_string(), "IFC class".to_string()),
            GroupBy::Material => (if names.is_empty() { "(No material)".into() } else { names.join(" / ") }, "material".into()),
            GroupBy::Property => (attribute(&grouping.property).unwrap_or_else(|| "(Missing property)".into()), grouping.property.clone()),
            GroupBy::Storey => {
                let mut cursor = id;
                let mut seen = BTreeSet::new();
                let mut name = None;
                while let Some(&parent) = relations.container.get(&cursor) {
                    source.charge()?;
                    if !seen.insert(parent) { return Err("Cyclic spatial containment".into()); }
                    let parent_entity = source.entity(parent)?;
                    if parent_entity.ifc_type == IfcType::IfcBuildingStorey { name = text(parent_entity.get(2)); break; }
                    cursor = parent;
                }
                (name.unwrap_or_else(|| "(No storey)".into()), "storey".into())
            }
            GroupBy::Section => {
                if let Some(name) = (!grouping.property.is_empty()).then(|| attribute(&grouping.property)).flatten() { (name,grouping.property.clone()) }
                else if let Some(name) = profiles.first() { (name.clone(),"material profile".into()) }
                else if let Some(name) = geometry_profile(&mut source,nodes)? { (name,"geometry profile".into()) }
                else if let Some((key,value)) = props.iter().find(|(key,_)| matches!(key.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str(), "section"|"sectionname"|"profile"|"profilename"|"crosssection"|"designation"|"sectionsize")) { (value.clone(),key.clone()) }
                else if let Some(ty) = type_name { (ty,"element type".into()) }
                else { (text(entity.get(4)).or_else(|| text(entity.get(2))).unwrap_or_else(|| "(Unclassified)".into()), "element attribute fallback".into()) }
            }
        };
        let group = groups.entry(name.to_lowercase()).or_insert_with(|| ColorizerGroup { name, source: origin.clone(), products: Vec::new() });
        if group.source != origin { group.source = "multiple sources".into(); }
        group.products.push(id);
    }
    let mut groups: Vec<_> = groups.into_values().collect();
    groups.sort_by(|a,b| b.products.len().cmp(&a.products.len()).then_with(|| a.name.cmp(&b.name)));
    Ok(ColorizerCatalog { schema: source.schema, product_ids: products.keys().copied().collect(), groups })
}
