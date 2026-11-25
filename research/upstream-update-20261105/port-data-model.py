from resolve import ROOT, OUT, PATTERN, resolve, edit
import re

prefix='rust/processing/src/data_model/'
mod=prefix+'mod.rs'
matches=list(PATTERN.finditer((OUT/'conflicts'/mod).read_text()))
material_refusal='''    let (materials, refused) = match materials {
        Ok(rows) => (rows, None),
        Err(reason) => (Vec::new(), Some(reason)),
    };
'''
native_model=matches[8][1].replace('classifications, materials, documents, spatial_hierarchy:',
    'classifications, materials, documents, refused, spatial_hierarchy:')
resolve(mod,[
    '    DecodedEntity, EntityDecoder, EntityScanner,\n',
    'theirs',
    '                        || extract_properties(&buckets.property_sets, content, &entity_index, cancel),\n                        || extract_quantities(&buckets.quantity_sets, content, &entity_index, cancel),\n',
    'both',
    matches[4][3]+'''    let project_units = project_ids.iter().map(|&id| (id, ProjectUnitAssignment::from(
        ifc_lite_core::project_units::ProjectUnits::resolve(&mut unit_decoder, id)))).collect();
''',
    '        &project_ids, &relationships, &mut unit_decoder, length_unit_scale, cancel,\n',
    '                || extract_classifications(&buckets.rel_classifications, content, &entity_index, cancel),\n',
    '        || extract_documents(&buckets.rel_documents, content, &entity_index, cancel),\n',
    material_refusal+native_model,
    'ours',
])
s=(ROOT/mod).read_text()
s=s.replace('generated::root_attr_indices(&type_name.to_ascii_uppercase())\n                    .is_some_and(|indices| indices.global_id < 0)',
    'slots::RootSlots::for_type(type_name).is_some_and(|slots| slots.global_id.is_none())')
(ROOT/mod).write_text(s,encoding='utf-8')

# Preserve the upstream per-worker split decoder and job buckets, adding bounded
# checks inside each parallel closure rather than reverting to per-row decoders.
for name in ('classifications','documents','metadata','properties','quantities','relationships'):
    p=prefix+name+'.rs';resolve(p,'theirs');s=(ROOT/p).read_text()
    if name in ('classifications','documents'):
        s=s.replace('            |split, job| {','            |split, job| {\n                if cancel.is_cancelled() { return Vec::new(); }')
        s=s.replace('                    .into_iter()\n','                    .into_iter()\n                    .take_while(|_| !cancel.is_cancelled())\n')
    elif name=='metadata':
        s=s.replace('            |(decoders, memo), job| {','            |(decoders, memo), job| {\n                if cancel.is_cancelled() { return None; }')
    elif name in ('properties','quantities'):
        s=s.replace('            |split, job| {','            |split, job| {\n                if cancel.is_cancelled() { return None; }')
        if name=='quantities':
            s=s.replace('                for quant_ref in has_quantities.iter() {','                for quant_ref in has_quantities.iter() {\n                    if cancel.is_cancelled() { return None; }')
    else:
        s=s.replace('            |split, (job, slots)| {','            |split, (job, slots)| {\n                    if cancel.is_cancelled() { return None; }')
        s=s.replace('            |split, &type_id| {','            |split, &type_id| {\n                if cancel.is_cancelled() { return Vec::new(); }')
        s=s.replace('                        for set_ref in set_list.iter() {','                        for set_ref in set_list.iter() {\n                            if cancel.is_cancelled() { break; }')
    (ROOT/p).write_text(s,encoding='utf-8')

p=prefix+'materials.rs'
resolve(p,['    cancel: Cancellation<\'_>,\n) -> Result<Vec<MaterialAssociation>, String> {\n','theirs'])
s=(ROOT/p).read_text().replace('            |split, job| {','            |split, job| {\n                if cancel.is_cancelled() { return Ok(Vec::new()); }')
s=s.replace('                for element_id in related {','                for element_id in related {\n                    if cancel.is_cancelled() { return Ok(Vec::new()); }')
(ROOT/p).write_text(s,encoding='utf-8')

p=prefix+'material_units.rs'
resolve(p,['use super::cancellation::Cancellation;\nuse super::types::Relationship;\n','theirs',
    '        for &project_id in project_ids {\n            if cancel.is_cancelled() { return context; }\n'])
resolve(prefix+'rooted.rs','use super::cancellation::Cancellation;\nuse super::slots::RootSlots;\n')
p=prefix+'rooted.rs';s=(ROOT/p).read_text();s=s.replace('root_attr_indices(&entity.type_name.to_ascii_uppercase()).is_some_and(|attrs| attrs.global_id >= 0)',
    'RootSlots::for_type(&entity.type_name).is_some_and(|slots| slots.global_id.is_some())')
(ROOT/p).write_text(s,encoding='utf-8')

# The server shim now has one owning extraction home shared with native.
for name in ('classifications','documents','material_units','materials','metadata','properties','quantities','relationships','rooted','rooted_tests','spatial','types','cancellation','project_units'):
    p=ROOT/f'apps/server/src/services/data_model/{name}.rs'
    if p.exists():p.unlink()
# Native unit tests now use the same owner as the native extraction path.
p=ROOT/'desktop/src-tauri/tests/semantic_units.rs'
p.write_text(p.read_text().replace('../../../apps/server/src/services/data_model/project_units.rs', '../../../rust/processing/src/data_model/project_units.rs'),encoding='utf-8')
print('Moved native cancellation/rooted/unit invariants into canonical processing data model.')
