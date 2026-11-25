import {attach,dir} from './cdp.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const c=await attach();
try{
 const data=await c.evaluate(`(()=>{const r=globalThis.__svdRenderer,s=r.getScene();return {
  at:new Date().toISOString(),adapter:r.getAdapterInfo(),deviceFeatures:[...r.getGPUDevice().features],diagnostics:r.getDiagnostics(),
  maps:{flatEntities:s.meshDataMap.size,instancedEntities:s.instancedEntityMap.size,boundingBoxes:s.boundingBoxes.size,
    flatBatches:s.getBatchedMeshes().length,templates:s.getInstancedTemplates().length,
    instances:s.getInstancedTemplates().reduce((n,t)=>n+t.instanceCount,0)},
  models:[...globalThis.__ifc_lite_viewer_store__.getState().models.values()].map(m=>({
    id:m.id,idOffset:m.idOffset,triangles:m.geometryResult.totalTriangles,vertices:m.geometryResult.totalVertices,
    indexKeys:m.ifcDataStore.spatialIndex?Object.keys(m.ifcDataStore.spatialIndex):null,
    indexMethods:m.ifcDataStore.spatialIndex?Object.getOwnPropertyNames(Object.getPrototypeOf(m.ifcDataStore.spatialIndex)):null,
    geometryKeys:Object.keys(m.geometryResult),sourceBytes:m.ifcDataStore.source.byteLength,
  })),stats:globalThis.__ifc_lite_render_stats__(),
 };})()`);
 const manifest=JSON.parse(await readFile('desktop/release/10.3.0-native-navigation-250ms-20261010/build-info.json','utf8'));
 const mismatches=[];for(const f of manifest.modifiedSourceFiles){
  const hash=createHash('sha256').update(await readFile(f.path)).digest('hex').toUpperCase();
  if(hash!==f.sha256)mismatches.push(f.path);
 }
 data.provenance={manifestSources:manifest.modifiedSourceFiles.length,mismatches};
 const runtimeMain=await readFile(`${dir}/main-runtime.js`),currentMain=await readFile('apps/viewer/dist/assets/main-hTJglwSo.js');
 data.provenance.distMainMatchesRuntime=runtimeMain.equals(currentMain);
 await writeFile(`${dir}/census.json`,JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));
}finally{c.close();}
