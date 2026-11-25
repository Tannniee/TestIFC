import {mkdtemp,mkdir,rm} from 'node:fs/promises';import {resolve,dirname,join} from 'node:path';import {BcfPublicationStore} from '../../packages/flow-nodes/dist/bcf-publication-store.js';
const root=await mkdtemp(resolve(import.meta.dirname,'test-tmp','path-probe-'));
const directory=resolve(root,'namespace');const paths=[];for(let p=directory;;p=dirname(p)){paths.push(p);if(dirname(p)===p)break;}
const created=await mkdir(directory,{recursive:true});console.log(JSON.stringify({directory,created,paths,includes:paths.includes(created)}));
try{await new BcfPublicationStore(join(root,'other')).prepare();console.log('prepare pass')}catch(e){console.log(e.stack)}finally{await rm(root,{recursive:true,force:true})}
