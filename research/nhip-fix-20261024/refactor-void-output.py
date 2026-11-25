from pathlib import Path
base=Path('rust/geometry/src/router/voids')
p=base/'mod.rs'
s=p.read_text(encoding='utf8')
chunks=[]
for name in ['process_element_with_voids_parts','process_element_with_submeshes_and_voids']:
    start=s.index('    pub fn '+name+'(')
    before=s[:start].splitlines(keepends=True)
    while before and (before[-1].lstrip().startswith('///') or not before[-1].strip()):
        start-=len(before.pop())
    body=s.index('{',s.index('    pub fn '+name+'('))
    depth=1;end=body+1
    while depth:
        if s[end]=='{':depth+=1
        elif s[end]=='}':depth-=1
        end+=1
    chunk=s[start:end]
    pos=chunk.index('    ) -> Result<')
    brace=chunk.index('{',pos)+1
    chunk=chunk[:brace]+'\n        if let Some(out) = self.try_source_frame(element, decoder, void_index, |router, decoder| {\n            router.'+name+'(element, decoder, void_index)\n        }) { return Ok(out); }\n'+chunk[brace:]
    chunk=chunk.replace('voided.clean_degenerate();','if self.precision_frame_active { voided.clean_degenerate_watertight(); }\n                voided.clean_degenerate();').replace('voided_mesh.clean_degenerate();','if self.precision_frame_active { voided_mesh.clean_degenerate_watertight(); }\n            voided_mesh.clean_degenerate();')
    chunks.append(chunk)
    s=s[:start]+s[end:]
s=s.replace('mod local_frame;','mod local_frame;\nmod output;\nmod source_frame;\nmod precision_seams;')
p.write_text(s,encoding='utf8')
header='// This Source Code Form is subject to the terms of the Mozilla Public\n// License, v. 2.0. If a copy of the MPL was not distributed with this\n// file, You can obtain one at https://mozilla.org/MPL/2.0/.\n\n//! Shared void output paths, preserving sub-mesh identity and final hygiene.\nuse super::{GeometryRouter, SourceHygiene};\nuse crate::{Mesh, Result, SubMesh, SubMeshCollection};\nuse ifc_lite_core::{DecodedEntity, EntityDecoder};\nuse rustc_hash::FxHashMap;\n\nimpl GeometryRouter {\n'
(base/'output.rs').write_text(header+'\n'.join(chunks)+'\n}\n',encoding='utf8')
retry=base/'bool2d_path/thin_box_retry.rs'
r=retry.read_text(encoding='utf8');index=r.index('/// Stronger than the coarse')
r=r[:index]+'pub(in crate::router::voids::bool2d_path) use super::super::super::precision_seams::closed_manifold;\n'
r=r.replace('use crate::Mesh;\n','').replace('use rustc_hash::{FxHashMap, FxHashSet};','use rustc_hash::FxHashSet;').replace('pub(in crate::router::voids::bool2d_path) fn context_precision','pub(in crate::router::voids) fn context_precision')
retry.write_text(r,encoding='utf8')
boolpath=base/'bool2d_path.rs';r=boolpath.read_text(encoding='utf8').replace('mod common_plane;','mod common_plane;\npub(super) use thin_box::retry::context_precision;');boolpath.write_text(r,encoding='utf8')
router=base.parent/'mod.rs';r=router.read_text(encoding='utf8').replace('    local_frame_enabled: Option<bool>,','    local_frame_enabled: Option<bool>,\n    precision_frame_active: bool,').replace('            local_frame_enabled: None,','            local_frame_enabled: None,\n            precision_frame_active: false,');router.write_text(r,encoding='utf8')
