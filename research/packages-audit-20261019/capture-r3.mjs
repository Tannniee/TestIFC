import { readFile, writeFile, readdir, copyFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding:'utf8'}).trim();
const hash = async p => createHash('sha256').update(await readFile(p)).digest('hex');
const manifest = join(import.meta.dirname, 'build-inputs-r3.json');
const release = 'F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-packages-audit-20261020-r3';
if (process.argv[2] === 'before') {
  assert.equal(git('status','--porcelain','--untracked-files=no'), '', 'tracked source must be clean');
  const files = execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const sources = {};
  for(const p of files) sources[p] = await hash(join(root,p));
  await writeFile(manifest,JSON.stringify({captured_utc:new Date().toISOString(), build_source_commit:git('rev-parse','HEAD'),branch:git('branch','--show-current'),tracked_clean:true,source_files_sha256:sources,wasm_sha256:await hash(join(root,'packages/wasm/pkg/ifc-lite_bg.wasm'))},null,2));
  console.log('Recorded build source',files.length);
} else if(process.argv[2] === 'after') {
  const m=JSON.parse(await readFile(manifest,'utf8'));
  for(const [p,h] of Object.entries(m.source_files_sha256)) assert.equal(await hash(join(root,p)),h,p);
  assert.equal(await hash(join(root,'packages/wasm/pkg/ifc-lite_bg.wasm')),m.wasm_sha256);
  const assets={};
  async function walk(dir,prefix='') {for(const item of await readdir(dir,{withFileTypes:true})) {const name=prefix+item.name;if(item.isDirectory())await walk(join(dir,item.name),name+'/');else assets[name]=await hash(join(dir,item.name));}}
  await walk(join(root,'apps/viewer/dist'));
  await mkdir(release); // refuse to overwrite a prior candidate
  const exe=join(release,'IFC-Lite.exe');
  await copyFile(join(root,'desktop/src-tauri/target/release/ifc-lite-desktop.exe'),exe);
  Object.assign(m,{embedded_frontend_files_sha256:assets,exe,exe_sha256:await hash(exe),exe_bytes:(await stat(exe)).size,built_utc:new Date().toISOString()});
  await writeFile(manifest,JSON.stringify(m,null,2));
  console.log(JSON.stringify({exe,sha256:m.exe_sha256,assets:Object.keys(assets).length,commit:m.build_source_commit}));
} else throw Error('Use before or after');
