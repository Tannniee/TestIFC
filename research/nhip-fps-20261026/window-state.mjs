import {attach} from './cdp.mjs';
const c=await attach();
try{
 console.log(await c.evaluate(`(async()=>{
  const invoke=globalThis.__TAURI_INTERNALS__.invoke;
  const state={visibility:document.visibilityState,focus:document.hasFocus(),location:location.href};
  for(const name of ['is_visible','is_minimized']){
   try{state[name]=await invoke('plugin:window|'+name,{label:'main'});}catch(error){state[name]=String(error);}
  }
  if(${process.env.FOCUS_OWN_WINDOW==='1'})for(const name of ['show','unminimize','set_focus']){
   try{await invoke('plugin:window|'+name,{label:'main'});state[name]='ok';}catch(error){state[name]=String(error);}
  }
  return state;
 })()`,true));
}finally{c.close();}
