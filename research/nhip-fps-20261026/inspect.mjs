import { attach, dir } from './cdp.mjs';
import { writeFile } from 'node:fs/promises';
const c=await attach();
try {
 const fn=await c.send('Runtime.evaluate',{expression:'globalThis.__ifc_lite_render_stats__'});
 const props=await c.send('Runtime.getProperties',{objectId:fn.result.objectId,ownProperties:true});
 const scopes=props.internalProperties.find(x=>x.name==='[[Scopes]]');
 const scopeList=await c.send('Runtime.getProperties',{objectId:scopes.value.objectId,ownProperties:true});
 for(const scope of scopeList.result.filter(x=>/^\d+$/.test(x.name))){
  const p=await c.send('Runtime.getProperties',{objectId:scope.value.objectId,ownProperties:true});
  console.log('SCOPE',scope.value.description,JSON.stringify(p.result.map(x=>({name:x.name,type:x.value?.type,description:x.value?.description?.slice(0,100)}))));
  let renderer=p.result.find(x=>x.name==='renderer');
  if(!renderer)for(const item of p.result.filter(x=>x.value?.type==='object'&&x.value.objectId)){
   const check=await c.send('Runtime.callFunctionOn',{objectId:item.value.objectId,functionDeclaration:'function(){return typeof this.getScene === "function" && typeof this.render === "function";}',returnByValue:true});
   if(check.result.value){renderer=item;break;}
  }
  if(renderer?.value?.objectId){
   await c.send('Runtime.callFunctionOn',{objectId:renderer.value.objectId,functionDeclaration:'function(){globalThis.__svdRenderer=this;}',returnByValue:true});
   break;
  }
 }
 const data=await c.evaluate(`(()=>{const r=globalThis.__svdRenderer,s=globalThis.__ifc_lite_viewer_store__.getState();return {
  rendererKeys:r?Object.keys(r):null,rendererMethods:r?Object.getOwnPropertyNames(Object.getPrototypeOf(r)):null,
  sceneKeys:r?Object.keys(r.getScene()):null,
  settings:Object.fromEntries(Object.entries(s).filter(([k,v])=>/(quality|shad|separa|visual|pixel|fast|perform|hover)/i.test(k)&&typeof v!=='function')),
  loading:s.loading,streaming:s.geometryStreamingActive,stats:globalThis.__ifc_lite_render_stats__?.(),
 };})()`);
 await writeFile(`${dir}/internals.json`,JSON.stringify(data,null,2));
 console.log(JSON.stringify(data));
}finally{c.close();}
