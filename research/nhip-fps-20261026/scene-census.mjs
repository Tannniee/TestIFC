import {attach,dir} from './cdp.mjs';
import {writeFile} from 'node:fs/promises';
const c=await attach();
try {
 const data=await c.evaluate(`(()=>{const r=globalThis.__svdRenderer,s=r.getScene();const batches=s.getBatchedMeshes(),templates=s.getInstancedTemplates();return {
  at:new Date().toISOString(),adapter:r.getAdapterInfo(),features:[...r.getGPUDevice().features],diagnostics:r.getDiagnostics(),
  maps:{flatEntities:s.meshDataMap.size,instancedEntities:s.instancedEntityMap.size,boundingBoxes:s.boundingBoxes.size,
    flatBatches:batches.length,templates:templates.length,instances:templates.reduce((n,t)=>n+t.instanceCount,0),
    batchTriangles:batches.reduce((n,b)=>n+b.indexCount/3,0),instancedTriangles:templates.reduce((n,t)=>n+t.indexCount*t.instanceCount/3,0)},
  batchKeys:batches[0]?Object.keys(batches[0]):[],templateKeys:templates[0]?Object.keys(templates[0]):[],
  models:[...globalThis.__ifc_lite_viewer_store__.getState().models.values()].map(m=>({id:m.id,idOffset:m.idOffset,
    triangles:m.geometryResult?.totalTriangles,vertices:m.geometryResult?.totalVertices,meshes:m.geometryResult?.meshes.length,
    instances:m.geometryResult?.instancedGeometryAabbs?.size,loadPath:m.loadPath})),
  stats:globalThis.__ifc_lite_render_stats__(),view:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
 };})()`);
 await writeFile(`${dir}/census.json`,JSON.stringify(data,null,2));console.log(JSON.stringify(data));
}finally{c.close();}
