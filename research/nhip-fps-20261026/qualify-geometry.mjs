import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {attach,dir,sleep} from './cdp.mjs';
const c=await attach();
const reference=JSON.parse(await readFile('research/nhip-fix-20261024/packaged-r5-original/selected-meshes.json','utf8'));
try{
 const deadline=Date.now()+120000;
 for(;;){
  const pending=await c.evaluate('(()=>{const r=globalThis.__svdRenderer,s=r.getScene();return s.hasQueuedMeshes()||s.isFinalizeInProgress()||s.hasResidencyRestoreWork();})()');
  if(!pending)break;
  assert.ok(Date.now()<deadline,'GPU restores must finish after navigation stops');
  await sleep(100);
 }
 await c.evaluate('globalThis.__svdRenderer.requestRender()');await sleep(500);
 const data=await c.evaluate(`(()=>{
  const s=globalThis.__ifc_lite_viewer_store__.getState(),m=[...s.models.values()][0];
  const ids=new Set(${JSON.stringify(reference.meshes.map(m=>m.expressId))});
  const r=globalThis.__svdRenderer,scene=r.getScene();
  return {error:s.error,loading:s.loading,loadPath:m.loadPath,modelName:m.name,
   coordinateInfo:m.geometryResult.coordinateInfo,idOffset:m.idOffset,
   diagnostics:m.geometryResult.diagnostics??null,renderer:r.getDiagnostics(),frame:r.getFrameStats(),
   gpuBudget:scene.getGpuResidencyBudget(),hostBudget:scene.hostBudgetBytes,
   pendingRestores:scene.hasResidencyRestoreWork(),meshCount:m.geometryResult.meshes.length,
   meshes:m.geometryResult.meshes.filter(x=>ids.has(x.expressId-m.idOffset)).map(x=>({
    expressId:x.expressId-m.idOffset,type:x.ifcType,positions:Array.from(x.positions),origin:x.origin,
    indices:Array.from(x.indices),color:x.color})),
   visibility:{document:document.visibilityState,focus:document.hasFocus()},
  };
 })()`);
 assert.equal(data.loading,false);assert.ok(!data.error);assert.equal(data.loadPath,'native');
 assert.equal(data.meshes.length,67);assert.equal(data.pendingRestores,false);
 assert.equal(data.gpuBudget,2048*1024*1024);assert.equal(data.hostBudget,3072*1024*1024);
 assert.equal(data.frame.batchesNotResident,0,'all batches needed by the settled view must be drawable');
 assert.equal(data.renderer.errors,0);assert.equal(data.renderer.gpuErrors,0);
 const differences=[];
 for(const mesh of data.meshes){
  const expected=reference.meshes.find(m=>m.expressId===mesh.expressId);
  for(const key of ['positions','indices','origin','color']){
   try{assert.deepEqual(mesh[key],expected[key]);}catch{differences.push({id:mesh.expressId,key});}
  }
 }
 data.geometryDifferences=differences;
 await writeFile(`${dir}/selected-meshes.json`,JSON.stringify(data));
 assert.deepEqual(differences,[],'renderer-only repair must retain the qualified r5 geometry');
 const image=await c.send('Page.captureScreenshot',{format:'png'});
 await writeFile(`${dir}/geometry-qualified.png`,Buffer.from(image.data,'base64'));
 await writeFile(`${dir}/geometry-qualification.json`,JSON.stringify({...data,meshes:undefined},null,2));
 console.log(JSON.stringify({meshes:data.meshes.length,differences,notResident:data.frame.batchesNotResident,
  gpuErrors:data.renderer.gpuErrors,diagnostics:data.diagnostics,meshCount:data.meshCount}));
}finally{c.close();}
