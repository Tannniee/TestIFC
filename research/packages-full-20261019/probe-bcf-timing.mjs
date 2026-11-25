import {mkdtemp,rm} from 'node:fs/promises';import {resolve} from 'node:path';
import {createNativeBcfWriteGateway} from '../../packages/flow-nodes/dist/bcf-publication-node.js';
import {startLocalBcfServer,LOCAL_BCF_TOKEN,LOCAL_BCF_PROJECT} from '../../apps/viewer/src/test/bcf-http-server.ts';
import {BcfApiClient} from '../../packages/bcf-api/dist/index.js';
const dir=await mkdtemp(resolve(import.meta.dirname,'test-tmp','timing-'));const peer=await startLocalBcfServer();const client=new BcfApiClient({baseUrl:peer.baseUrl,getAccessToken:()=>LOCAL_BCF_TOKEN});
const g=createNativeBcfWriteGateway({directory:dir});const intent={nodeType:'bcf.createTopic',operation:'createTopic',baseUrl:'https://bcf-probe.test/bcf',version:'2.1',projectId:LOCAL_BCF_PROJECT,payload:{title:'Windows journal diagnostic'}};
try{let t=performance.now();await g.write(intent,()=>client.createTopic(LOCAL_BCF_PROJECT,intent.payload),[LOCAL_BCF_TOKEN]);console.log('write_ms',performance.now()-t);for(let n=0;n<3;n++){t=performance.now();const rows=await g.list();console.log('list_ms',performance.now()-t,'rows',rows.length);}console.log('effects',peer.state.acceptedWrites);}finally{await peer.close();await rm(dir,{recursive:true,force:true})}

