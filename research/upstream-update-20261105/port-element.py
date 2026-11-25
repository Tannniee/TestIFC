from resolve import ROOT, edit

p='rust/processing/src/element/session_work.rs'
edit(p,'Candidate(SubMeshCollection),','Candidate(SubMeshCollection, Option<ifc_lite_geometry::OrientVerdict>),')
edit(p,'Geometry(Vec<Mesh>),','Geometry(Vec<Mesh>, Option<ifc_lite_geometry::OrientVerdict>),')
edit(p,'Ok(sub_meshes) if !sub_meshes.is_empty() => PrimaryOutcome::Candidate(sub_meshes),',
'''Ok(sub_meshes) if !sub_meshes.is_empty() => {
            let boundary = (strategy == PrimaryStrategy::VoidedSubmeshes)
                .then(|| router.take_source_boundary_verdict(job.id)).flatten();
            PrimaryOutcome::Candidate(sub_meshes, boundary)
        },''')
edit(p,'Ok(parts) if parts.iter().any(|mesh| !mesh.is_empty()) => PartsOutcome::Geometry(parts),',
    'Ok(parts) if parts.iter().any(|mesh| !mesh.is_empty()) => PartsOutcome::Geometry(parts, router.take_source_boundary_verdict(job.id)),')
p='rust/processing/src/element/session_accept.rs'
edit(p,'PrimaryOutcome::Candidate(sub_meshes) => {','PrimaryOutcome::Candidate(sub_meshes, boundary) => {')
edit(p,'                            strategy.topology(layer_class),','                            strategy.topology(layer_class),\n                            boundary,')
edit(p,'PartsOutcome::Geometry(parts) => self.assemble_parts(&assembly, parts, ctx, decoder),',
    'PartsOutcome::Geometry(parts, boundary) => self.assemble_parts(&assembly, parts, ctx, decoder, boundary),')
edit(p,'self.assemble_parts(&assembly, parts, ctx, decoder);','self.assemble_parts(&assembly, parts, ctx, decoder, None);')
edit(p,'        parts: Vec<Mesh>,\n        ctx:', '        parts: Vec<Mesh>,\n        ctx:') if False else None
edit(p,'        decoder: &mut EntityDecoder,\n    ) {\n        for mesh',
    '        decoder: &mut EntityDecoder,\n        boundary: Option<ifc_lite_geometry::OrientVerdict>,\n    ) {\n        for mesh')
edit(p,'                &mut self.hasher,\n            ));','                &mut self.hasher,\n                boundary,\n            ));')
p='rust/processing/src/element/presentation_source.rs'
edit(p,'    topology: CollectionTopology,\n)', '    topology: CollectionTopology,\n    boundary: Option<ifc_lite_geometry::OrientVerdict>,\n)')
s=(ROOT/p).read_text();s=s.replace('let verdict = orient_mesh_outward_verdict(&mut mesh);','let verdict = boundary.unwrap_or_else(|| orient_mesh_outward_verdict(&mut mesh));')
s=s.replace('            hash: HashPolicy::Submesh(verdict),','            hash: HashPolicy::Submesh(verdict),\n            preserve_finite_boundary: boundary.is_some(),')
s=s.replace('        hash: HashPolicy::Fallback(verdict),','        hash: HashPolicy::Fallback(verdict),\n        preserve_finite_boundary: boundary.is_some(),')
s=s.replace('    hasher: &mut Option<GeometryHasher>,\n) -> Vec<MeshData> {','    hasher: &mut Option<GeometryHasher>,\n    boundary: Option<ifc_lite_geometry::OrientVerdict>,\n) -> Vec<MeshData> {')
(ROOT/p).write_text(s,encoding='utf-8')
p='rust/processing/src/element/presentation.rs'
edit(p,"pub(super) struct ReadyBody<'a> {", "pub(super) struct ReadyBody<'a> {\n    pub preserve_finite_boundary: bool,")
p='rust/processing/src/element/assembly_types.rs'
edit(p,'        hash: HashPolicy::Type,','        hash: HashPolicy::Type,\n        preserve_finite_boundary: false,')
p='rust/processing/src/element/assembly_submeshes.rs'
s=(ROOT/p).read_text();s=s.replace('            body.uvs,\n','            body.uvs,\n            body.preserve_finite_boundary,\n')
s=s.replace('        body.uvs,\n','        body.uvs,\n        body.preserve_finite_boundary,\n') if False else s
# Different indentation at the plain funnel.
s=s.replace('        body.uvs,\n    );','        body.uvs,\n        body.preserve_finite_boundary,\n    );')
s=s.replace('rotation, record);','rotation, record, body.preserve_finite_boundary);')
s=s.replace('    uvs: Option<Vec<f32>>,\n) -> MeshData {','    uvs: Option<Vec<f32>>,\n    preserve_finite_boundary: bool,\n) -> MeshData {')
s=s.replace('class, rotation, uvs)','class, rotation, uvs, preserve_finite_boundary)')
(ROOT/p).write_text(s,encoding='utf-8')
p='rust/processing/src/element/assembly_fallback.rs'
edit(p,"    record: Option<Record<'_>>,\n)","    record: Option<Record<'_>>,\n    preserve_finite_boundary: bool,\n)")
edit(p,'source, class, rotation, None);','source, class, rotation, None, preserve_finite_boundary);')
print('Ported finite-boundary proof through owned work replies and source-free mesh assembly.')
