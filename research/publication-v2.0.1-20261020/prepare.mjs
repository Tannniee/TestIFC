import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root='F:/Steel/VBA/IFC-Lite-Core104';
const dir=fileURLToPath(new URL('.',import.meta.url));
const index=dir+'snapshot.index';
if(existsSync(index)) throw Error('Snapshot index already exists; inspect evidence first');
const common={...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'};
const env={...common,GIT_INDEX_FILE:index,GIT_AUTHOR_NAME:'Tannniee',GIT_AUTHOR_EMAIL:'261090942+Tannniee@users.noreply.github.com',GIT_COMMITTER_NAME:'Tannniee',GIT_COMMITTER_EMAIL:'261090942+Tannniee@users.noreply.github.com'};
const git=(args,options={})=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',maxBuffer:512*1024*1024,stdio:['pipe','pipe','pipe'],...options});
const original=args=>git(args,{env:common});
const beforeIndex=original(['ls-files','--stage','-z']);
const source=original(['rev-parse','HEAD']).trim();
if(source!=='13e402c42884c479fc22437c2e8f7a8c5dad53c5') throw Error('Source changed');
const parent=git(['rev-parse','refs/publication/testifc-main-before-v2.0.1']).trim();
if(parent!=='bb823f5047360e04acaf4962cbca2ab9b0059006') throw Error('Unexpected main parent');
git(['read-tree',source]);
const entries=()=>git(['ls-files','--stage','-z']).split('\0').filter(Boolean).map(x=>{const [h,path]=x.split('\t');const [mode,blob]=h.split(' ');return {mode,blob,path};});
const put=(path,content,mode='100644')=>{const blob=git(['hash-object','-w','--stdin'],{input:content}).trim();git(['update-index','--add','--cacheinfo',`${mode},${blob},${path}`]);};
const remove=path=>git(['update-index','--force-remove','--',path]);
const workflows=[]; const removed=[]; const sanitized=[];
for(const e of entries()){
 if(e.path.startsWith('.github/workflows/')){
  const target=e.path.replace('.github/workflows/','.github/workflows-disabled/')+'.disabled';
  git(['update-index','--add','--cacheinfo',`${e.mode},${e.blob},${target}`]);remove(e.path);workflows.push({from:e.path,to:target});
 }
 if(e.path==='BURKWIL_DX_B.ifc'||/^desktop\/(reports|release)\//.test(e.path)){remove(e.path);removed.push(e.path);}
 if(/^desktop\/[^/]*(?:VALIDATION|RESEARCH|AUDIT|FOLLOWUP)[^/]*\.md$/i.test(e.path)||e.path==='desktop/NAVIGATION-RENDER-250MS.md'){
  put(e.path,`# Local qualification record\n\nThe detailed historical validation record is retained locally with the private\ninput models and executable hashes. It is omitted from this public source snapshot.\nSee [the v2.0.1 publication record](../PUBLICATION-v2.0.1.md) for source identity,\npreserved features, prior qualification scope and remaining limits.\n`);sanitized.push(e.path);
 }
}
const note=`# TestIFC v2.0.1 source publication\n\nPublished to Tannniee/TestIFC main at the user's request. This snapshot updates\nmain while preserving its previous commit history and the v2.0.0 tag.\n\n## Source identity\n\n- Audited source: ${source}.\n- Prior TestIFC main: ${parent}.\n- Upstream package source: 61d209288c1b117d405628ead302d0ee700bd2a0.\n- Publication tag: v2.0.1. Package versions retain their actual identities:\n  custom viewer 4.0.0, desktop host/WASM 10.4.0, Rust workspace 20.4.0.\n- Complete workspace catalogue: 62 packages, including 57 published packages.\n\n## Preserved custom behavior\n\nThe native Windows host, geometry transport, cooperative loading, native instancing,\nbounded picking, Colorizer with persistent IFC export, fixed canvas and panel docking,\nTestIFC navigation/ViewCube/section tools, federation and GIS retain their custom\nimplementations. The upstream web interface is not substituted for this viewer.\nThe upgrade includes the matching source, manifests, lockfiles, tests and API guides.\n\n## Qualification already completed before publication\n\nThe prior audit completed root typechecking (120 tasks), Windows lint with zero\nerrors, composite complete-package coverage (22,410 passed; 164 conditional skips),\n855 viewer cases with one existing external-fixture skip, and Rust workspace tests\n(4,797 passed; 41 existing ignored tests). The pinned nightly Clippy check passed.\nRegistry audits reported zero known npm vulnerabilities; patched Rust closures\nreported zero vulnerabilities with an existing async-std maintenance notice.\n\nThe delivered local executable passed 99 native quality/navigation/interaction groups,\nincluding strict two-model section-box gestures. Persistent IFC recoloring/export\nand representative large-model loading were checked on private inputs. These are\nprior recorded results, not checks run during this publication. The historical\nfirst Box failure's cause remains unproven; current strict retakes passed.\nUnknown vertical CRS datum, storage-volume flush requirements for BCF, three missing\noptional Rust BOS tables, and untested external corpus coverage remain documented limits.\nRaw private evidence and executables remain local. This snapshot makes no new\ngeometry, performance or all-corpus correctness claim.\n\n## Source-only publication; automation disabled\n\nNo build, dependency installation, test execution or GitHub Actions run is part of\nthis publication. Repository Actions permissions are disabled before the push.\nAll ${workflows.length} workflow definitions are archived under\n.github/workflows-disabled/ with a .disabled suffix; .github/workflows/ is empty.\nThe publication commit also carries [skip ci]. Composite-action sources are retained\nfor reference but have no active invoking workflow.\n\nPrivate input models, raw local reports, research directories, executables, installers,\ncompiler outputs, dependency directories, caches and generated WASM runtime files\nare excluded. Public upstream fixtures and source assets remain. The committed\nWASM type declarations remain available for source typechecking. Original sources,\nprivate models and old executable deliveries are not modified by publication.\n\nThe upstream MPL-2.0 license, notices and package attributions are retained.\n`;
put('PUBLICATION-v2.0.1.md',note);
put('desktop/CORE-UPGRADE-10.4.0.md','# Custom desktop core 10.4\n\nRust 20.4.0 and WASM/host 10.4.0 are integrated while preserving the custom viewer\n4.0.0 interface and native behavior. Package sources use upstream production\n61d209288c1b117d405628ead302d0ee700bd2a0.\n\nSee [the complete source publication record](../PUBLICATION-v2.0.1.md) for the\npreserved features, prior qualification and explicit limits.\n');
put('desktop/PACKAGES-FULL-10.4.0.md','# Complete package integration\n\nThe Info catalogue contains all 62 workspace packages (57 published), with their\nactual imported versions and 210 workspace dependency edges. Source, tests and\nmatching documentation accompany the manifests. Info is a workspace catalogue;\nit does not claim all headless and provider packages are bundled in the desktop EXE.\n\nNew package sources include ai, ids-agent, ids-authoring, report-contract, semantic\nand source-autodesk. The customized viewer interface remains in place.\n\nWindows BCF storage retains write-capable directory flushes and identity/claim\nchecks; successful immutable self-process identity may be reused, foreign identities\nare queried afresh. A storage volume must support the required flush operations.\n\nSee [the publication and audit summary](../PUBLICATION-v2.0.1.md).\n');
const readme=git(['show',`${source}:README.md`]);
put('README.md','> TestIFC custom desktop source, tag v2.0.1. See [publication identity and audit scope](PUBLICATION-v2.0.1.md) and [desktop instructions](desktop/README.md). GitHub Actions are disabled; workflow definitions are archived.\n\n'+readme);
const final=entries();
const forbidden=final.filter(e=>/^\.github\/workflows\//.test(e.path)||/(^|\/)(node_modules|target|dist|build|\.turbo)(\/|$)/.test(e.path)||/^desktop\/(reports|release)\//.test(e.path)||/\.(exe|dll|wasm|pdb|zip|7z|sqlite|db|pvf|tsbuildinfo)$/i.test(e.path)||/(^|\/)\.env(?:\.(?:local|production|development))?$/.test(e.path)||/^research\//.test(e.path)||e.path==='BURKWIL_DX_B.ifc');
if(forbidden.length) throw Error('Forbidden snapshot paths: '+forbidden.map(e=>e.path).join(', '));
const unique=[...new Set(final.map(e=>e.blob))];
const batch=git(['cat-file','--batch'],{input:unique.join('\n')+'\n',encoding:null});
let offset=0;let scanned=0;const secrets=[];const large=[];
for(const expected of unique){
 const end=batch.indexOf(10,offset);const [hash,type,sizeText]=batch.subarray(offset,end).toString().split(' ');const size=Number(sizeText);offset=end+1;
 if(hash!==expected||type!=='blob'||!Number.isFinite(size)) throw Error('Invalid blob batch');
 const bytes=batch.subarray(offset,offset+size);offset+=size+1;const paths=final.filter(e=>e.blob===hash).map(e=>e.path);
 if(size>20*1024*1024) large.push({paths,size});
 if(!bytes.includes(0)){scanned++;if(/(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{70,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(bytes.toString('utf8'))) secrets.push(...paths);}
}
if(secrets.length) throw Error('Potential credentials in paths (values redacted): '+secrets.join(', '));
if(large.length) throw Error('Oversize files require inspection: '+JSON.stringify(large));
const check=git(['diff','--cached','--check']);
const tree=git(['write-tree']).trim();
const message=`chore: publish audited TestIFC source v2.0.1 [skip ci]\n\nUpdate main to the completed custom desktop package/core audit source snapshot.\nPreserve prior TestIFC history, custom viewer behavior and actual package versions.\nArchive all workflow definitions and exclude private inputs and generated deliveries.\n\nAudited-source: ${source}\nUpstream-package-source: 61d209288c1b117d405628ead302d0ee700bd2a0\nPublication: source only; no builds or Actions\n`;
const commit=git(['commit-tree',tree,'-p',parent],{input:message}).trim();
git(['update-ref','refs/publication/testifc-v2.0.1',commit]);
if(beforeIndex!==original(['ls-files','--stage','-z'])) throw Error('Original index changed');
const result={source,parent,tree,commit,fileCount:final.length,uniqueBlobs:unique.length,textBlobsScanned:scanned,activeWorkflows:0,archivedWorkflows:workflows.length,workflows,removed,sanitized,forbiddenPaths:0,potentialCredentials:0,originalIndexUnchanged:true,buildsRun:false};
writeFileSync(dir+'prepared.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,workflows:undefined,sanitized:undefined}));
