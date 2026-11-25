import {attach,dir} from './cdp.mjs';
import {writeFile} from 'node:fs/promises';
const c=await attach();
try{
 const r=await c.evaluate(`(()=>{const r=globalThis.__svdRenderer,s=r.getScene();return {
  pick:r.pickingManager.pick.toString(),prepareBatchedPick:r.pickingManager.prepareBatchedPick.toString(),
  sceneRaycast:s.raycast.toString(),renderFrame:r.renderFrame.toString(),
  sceneMethods:Object.getOwnPropertyNames(Object.getPrototypeOf(s)),
  allTemplates:s.getInstancedTemplates().length,
  instances:s.getInstancedTemplates().reduce((n,t)=>n+t.instanceCount,0),
 };})()`);
 for(const name of ['pick','prepareBatchedPick','sceneRaycast','renderFrame'])await writeFile(`${dir}/runtime-${name}.txt`,r[name]);
 await writeFile(`${dir}/runtime-info.json`,JSON.stringify(r,null,2));
 console.log(JSON.stringify({allTemplates:r.allTemplates,instances:r.instances}));
}finally{c.close();}
