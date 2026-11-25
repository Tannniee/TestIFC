import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const root='F:/Steel/VBA/IFC-Lite-Core104';
const prepared=JSON.parse(readFileSync(new URL('prepared.json',import.meta.url),'utf8'));
const inspected=JSON.parse(readFileSync(new URL('github-inspect.json',import.meta.url),'utf8'));
if(inspected.permissions.enabled||Date.now()-Date.parse(inspected.at)>300000) throw Error('Fresh Actions-disabled verification required');
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never',GIT_COMMITTER_NAME:'Tannniee',GIT_COMMITTER_EMAIL:'261090942+Tannniee@users.noreply.github.com'};
const git=(args,options={})=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe'],...options});
const remote='https://github.com/Tannniee/TestIFC.git';
const refs=git(['ls-remote',remote,'refs/heads/main','refs/tags/v2.0.1','refs/tags/v2.0.0']);
if(!refs.includes(prepared.parent+'\trefs/heads/main')||refs.includes('refs/tags/v2.0.1')||!refs.includes('9cf52a61e8eaa27fabf2d4ae4f57d85fd45ccd7d\trefs/tags/v2.0.0')) throw Error('Destination refs changed');
try { git(['show-ref','--verify','refs/tags/v2.0.1']); throw Error('Local tag already exists'); } catch(e){if(e.status!==128&&e.status!==1)throw e;}
git(['merge-base','--is-ancestor',prepared.parent,prepared.commit]);
git(['tag','-a','v2.0.1',prepared.commit,'-F','-'],{input:'TestIFC v2.0.1 — audited custom desktop source [skip ci]\n\nSource-only publication to main; no build or GitHub Actions.\n62 workspace packages; custom UI and native behavior retained.\nSource provenance and qualification limits: PUBLICATION-v2.0.1.md.\n'});
const tagObject=git(['rev-parse','refs/tags/v2.0.1']).trim();
const output=git(['-c','push.followTags=false','push','--atomic',remote,prepared.commit+':refs/heads/main','refs/tags/v2.0.1:refs/tags/v2.0.1']);
const result={at:new Date().toISOString(),remote,commit:prepared.commit,tagObject,output,refs:git(['ls-remote',remote,'refs/heads/main','refs/tags/v2.0.1','refs/tags/v2.0.1^{}','refs/tags/v2.0.0','refs/tags/v2.0.0^{}'])};
writeFileSync(new URL('pushed.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
