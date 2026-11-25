import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, dir, sleep } from './cdp.mjs';
await mkdir(dir, { recursive: true });
const exe = resolve(process.env.SMOKE_EXE || 'desktop/release/10.3.0-native-navigation-250ms-20261010/IFC-Lite.exe');
const model = process.env.DIAG_MODEL || 'F:/Working/IFC Temp/Nhip chinh.ifc';
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-svd-fps-'));
const child = spawn(exe, [], { windowsHide: true, env: { ...process.env,
  WEBVIEW2_USER_DATA_FOLDER: profile,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run`,
}, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', data => appendFile(`${dir}/host.log`, data));
child.stderr.on('data', data => appendFile(`${dir}/host.log`, data));
child.on('error', error => console.error(error));
child.on('exit', code => { console.log('HOST_EXIT', code); process.exitCode = code || 0; });
const session = { exe, model, port, profile, pid: child.pid, started: new Date().toISOString(),
  sha256: createHash('sha256').update(await readFile(exe)).digest('hex') };
await writeFile(`${dir}/session.json`, JSON.stringify(session, null, 2));
let client;
try {
  let targets;
  for (let i = 0; i < 120; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
    catch (error) { if (i === 119) throw error; }
    if (targets?.some(t => t.type === 'page')) break;
    await sleep(500);
  }
  client = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  client.listeners.add(message => {
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      appendFile(`${dir}/console.log`, JSON.stringify({ at: Date.now(), type: message.params.type, text }) + '\n');
    }
    if (message.method === 'Runtime.exceptionThrown') appendFile(`${dir}/errors.jsonl`, JSON.stringify(message.params) + '\n');
  });
  await client.send('Runtime.enable');
  await client.send('Page.bringToFront');
  for (let i = 0; i < 120; i++) {
    if (await client.evaluate('!!globalThis.__ifc_lite_viewer_store__')) break;
    await sleep(500);
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  await writeFile(`${dir}/system-info.json`, JSON.stringify(await browser.send('SystemInfo.getInfo'), null, 2));
  browser.close();
  session.environment = await client.evaluate(`({native:!!globalThis.__IFCLITE_NATIVE__,dpr:devicePixelRatio,
    width:innerWidth,height:innerHeight,visibility:document.visibilityState,userAgent:navigator.userAgent,
    fastView:globalThis.__ifc_lite_viewer_store__.getState().fastView})`);
  if (!session.environment.native) throw Error('Expected native default in this packaged test');
  await writeFile(`${dir}/session.json`, JSON.stringify(session, null, 2));
  const doc = await client.send('DOM.getDocument');
  const node = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input-open' });
  await client.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [model] });
  const started = Date.now();
  console.log('LOAD_STARTED', JSON.stringify(session));
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const state = await client.evaluate(`(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();return {
      loading:s.loading,error:s.error??s.loadError,progress:s.progress,streaming:s.geometryStreamingActive,
      stats:globalThis.__ifc_lite_render_stats__?.(),
      models:[...s.models.values()].map(m=>({id:m.id,loadPath:m.loadPath,entities:m.ifcDataStore?.entityCount,
        meshes:m.geometryResult?.meshes.length,triangles:m.geometryResult?.totalTriangles,
        vertices:m.geometryResult?.totalVertices,instances:m.geometryResult?.instancedGeometryAabbs?.size}))};})()`);
    const sample = { elapsedMs: Date.now() - started, ...state };
    await appendFile(`${dir}/load-states.jsonl`, JSON.stringify(sample) + '\n');
    console.log(JSON.stringify(sample));
    if (state.error) throw Error(state.error);
    if (!state.loading && state.models.some(m => m.meshes > 0)) {
      await sleep(12000);
      await writeFile(`${dir}/ready.json`, JSON.stringify(sample, null, 2));
      const png = await client.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${dir}/loaded.png`, Buffer.from(png.data, 'base64'));
      console.log('READY_FOR_MEASUREMENT');
      break;
    }
  }
} catch (error) {
  await writeFile(`${dir}/launch-error.txt`, error.stack);
  console.error(error);
} finally { client?.close(); }
// Keep this launcher attached to its own host; cleanup is an explicit final step.

