// SPDX-License-Identifier: MPL-2.0
use ifc_lite_core::{AttributeValue as A, DecodedEntity, EntityDecoder, EntityScanner, IfcType};
use rustc_hash::FxHashMap;
use std::{collections::{BTreeMap, BTreeSet}, sync::Arc};

pub(super) struct Source<'a> {
    pub schema: String,
    pub rows: BTreeMap<u32, String>,
    pub products: BTreeMap<u32, u32>,
    pub styled: BTreeMap<u32, Vec<u32>>,
    pub maps: BTreeMap<u32, Vec<u32>>,
    pub next_id: u32,
    decoder: EntityDecoder<'a>,
    cache: BTreeMap<u32, Arc<DecodedEntity>>,
    work: usize,
}

pub(super) fn refs(value: Option<&A>) -> Vec<u32> {
    match value { Some(A::List(items)) => items.iter().filter_map(A::as_entity_ref).collect(), _ => Vec::new() }
}

impl<'a> Source<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self, String> {
        let schema = crate::source_header::declared_schema(bytes).ok_or("An IFC STEP schema is required")?.to_ascii_uppercase();
        if !matches!(schema.as_str(), "IFC2X3" | "IFC4" | "IFC4X3" | "IFC4X3_ADD2" | "IFC4X3_ADD1") {
            return Err(format!("Colorizer does not support {schema}"));
        }
        let mut rows = BTreeMap::new();
        let mut index = FxHashMap::default();
        let mut scanner = EntityScanner::new(bytes);
        while let Some((id, name, start, end)) = scanner.next_entity() {
            if rows.len() >= 2_000_000 { return Err("Colorizer source entity budget exceeded".into()); }
            if rows.insert(id, name.to_ascii_uppercase()).is_some() {
                return Err("Duplicate source express id".into());
            }
            index.insert(id, (start, end));
        }
        if scanner.skipped_oversized_ids() > 0 || scanner.malformed_record_start().is_some() {
            return Err("Colorizer requires readable STEP records and 32-bit express ids".into());
        }
        let next_id = rows.last_key_value().map_or(Some(1), |(id, _)| id.checked_add(1)).ok_or("IFC express id capacity exceeded")?;
        let mut source = Self { schema, rows, products: BTreeMap::new(), styled: BTreeMap::new(), maps: BTreeMap::new(),
            next_id, decoder: EntityDecoder::with_index(bytes, index), cache: BTreeMap::new(), work: 0 };
        let ids: Vec<_> = source.rows.keys().copied().collect();
        for id in ids {
            let name = &source.rows[&id];
            // Decode products and inverse presentation rows, not every coordinate list.
            let ty = IfcType::from_str(name);
            if ty.is_subtype_of(IfcType::IfcProduct) {
                let entity = source.entity(id)?;
                if let Some(rep) = entity.get_ref(6) { source.products.insert(id, rep); }
            } else if name == "IFCSTYLEDITEM" {
                if let Some(target) = source.entity(id)?.get_ref(0) { source.styled.entry(target).or_default().push(id); }
            } else if name == "IFCINDEXEDCOLOURMAP" || name.starts_with("IFCINDEXED") && name.ends_with("TEXTUREMAP") {
                let slot = if name == "IFCINDEXEDCOLOURMAP" { 0 } else { 1 };
                if let Some(target) = source.entity(id)?.get_ref(slot) { source.maps.entry(target).or_default().push(id); }
            }
        }
        Ok(source)
    }

    pub fn charge(&mut self) -> Result<(), String> {
        self.work += 1;
        if self.work > 20_000_000 { return Err("Colorizer reference work budget exceeded".into()); }
        Ok(())
    }

    pub fn entity(&mut self, id: u32) -> Result<Arc<DecodedEntity>, String> {
        self.charge()?;
        if let Some(entity) = self.cache.get(&id) { return Ok(entity.clone()); }
        let entity = Arc::new(self.decoder.decode_by_id(id).map_err(|e| format!("Cannot read #{id}: {e}"))?);
        self.cache.insert(id, entity.clone());
        Ok(entity)
    }

    /// Only representation wrappers are copied. Parametric geometry, placements,
    /// material definitions and profile records remain intact.
    pub fn children(&mut self, id: u32) -> Result<Vec<u32>, String> {
        let entity = self.entity(id)?;
        Ok(match entity.ifc_type {
            IfcType::IfcProductDefinitionShape => refs(entity.get(2)),
            IfcType::IfcShapeRepresentation => refs(entity.get(3)),
            IfcType::IfcRepresentationMap => entity.get_ref(1).into_iter().collect(),
            IfcType::IfcMappedItem => entity.get_ref(0).into_iter().collect(),
            IfcType::IfcGeometricSet => refs(entity.get(0)),
            _ => Vec::new(),
        })
    }

    pub fn terminal(&mut self, id: u32) -> Result<bool, String> {
        let entity = self.entity(id)?;
        let ty = &entity.ifc_type;
        Ok(ty.is_subtype_of(IfcType::IfcSolidModel) || ty.is_subtype_of(IfcType::IfcTessellatedFaceSet)
            || ty.is_subtype_of(IfcType::IfcSurface) || matches!(ty,
                IfcType::IfcBooleanResult | IfcType::IfcBooleanClippingResult |
                IfcType::IfcShellBasedSurfaceModel | IfcType::IfcFaceBasedSurfaceModel))
    }

    /// Iterative DFS reports cycles; a global visited set is valid because this
    /// walk computes styling ownership, not accumulated geometry.
    pub fn nodes(&mut self, root: u32) -> Result<Vec<u32>, String> {
        let mut stack = vec![(root, false)];
        let (mut path, mut visited) = (BTreeSet::new(), BTreeSet::new());
        let mut nodes = Vec::new();
        while let Some((id, leaving)) = stack.pop() {
            self.charge()?;
            if leaving { path.remove(&id); nodes.push(id); continue; }
            if path.contains(&id) { return Err(format!("Cyclic IFC representation at #{id}")); }
            if !visited.insert(id) { continue; }
            path.insert(id);
            stack.push((id, true));
            for child in self.children(id)?.into_iter().rev() { stack.push((child, false)); }
        }
        Ok(nodes)
    }

    pub fn surface_products(&mut self) -> Result<BTreeMap<u32, Vec<u32>>, String> {
        let products: Vec<_> = self.products.iter().map(|(&p,&r)| (p,r)).collect();
        let mut result = BTreeMap::new();
        for (product, root) in products {
            let nodes = self.nodes(root)?;
            let mut surface = false;
            for &id in &nodes { surface |= self.terminal(id)?; }
            if surface { result.insert(product, nodes); }
        }
        Ok(result)
    }
}
