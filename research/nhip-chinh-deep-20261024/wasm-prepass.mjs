import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const mod=await import(pathToFileURL('F:/Steel/VBA/IFC-Lite-Core104/packages/wasm/pkg/ifc-lite.js'));
mod.initSync({module:await readFile('F:/Steel/VBA/IFC-Lite-Core104/packages/wasm/pkg/ifc-lite_bg.wasm')});
const source=await readFile('F:/Working/IFC Temp/Nhip chinh.ifc');const api=new mod.IfcAPI();
try{const t=performance.now();const pre=api.buildPrePassOnce(source);console.log('PREPASS',performance.now()-t,Object.keys(pre));console.log('FIELDS',JSON.stringify(Object.fromEntries(Object.entries(pre).map(([k,v])=>[k,ArrayBuffer.isView(v)?{type:v.constructor.name,length:v.length,first:Array.from(v.slice(0,6))}:v]))).slice(0,2500));await writeFile(`${import.meta.dirname}/wasm-prepass-summary.json`,JSON.stringify(Object.fromEntries(Object.entries(pre).map(([k,v])=>[k,ArrayBuffer.isView(v)?{type:v.constructor.name,length:v.length}:v])),null,2));}finally{api.clearPrePassCache();api.free();}
