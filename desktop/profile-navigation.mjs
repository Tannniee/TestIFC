/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const desktop = dirname(fileURLToPath(import.meta.url));
const reportDir = join(desktop, 'reports');
await mkdir(reportDir, { recursive: true });
const server = createServer();
await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
const port = server.address().port;
await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-desktop-smoke-'));
const exe = join(desktop, 'src-tauri/target/release/ifc-lite-desktop.exe');
const child = spawn(exe, [], {
  windowsHide: true,
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run` },
  stdio: 'inherit',
});
let launchError;
child.on('error', error => { launchError = error; });
let browser;
let page;
const errors = [];
const diagnostics = [];
const result = { executable: exe, tests: [], errors, diagnostics };
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Desktop exited: ${child.exitCode}`);
    try { ready = (await fetch(`${endpoint}/json/version`)).ok; }
    catch (error) { if (Date.now() >= deadline) throw error; }
    if (ready) break;
    await new Promise(yes => setTimeout(yes, 250));
  }
  if (!ready) throw new Error('WebView2 debugging endpoint did not open');
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts().flatMap(context => context.pages())[0];
  if (!page) throw new Error('Missing desktop WebView2 page');
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('requestfailed', request => diagnostics.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && response.headers()['content-type']?.includes('text/html')) {
      diagnostics.push(`HTML returned for script: ${response.url()}`);
    }
  });
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push(`${message.type()}: ${message.text()}`);
  });
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 60000 });
  await page.locator('#file-input-open').setInputFiles(resolve(desktop, '../apps/viewer/public/samples/building-architecture.ifc'));
  await page.waitForFunction(() => Array.from(globalThis.__ifc_lite_viewer_store__.getState().models.values()).some(m => m.geometryResult?.meshes?.length), null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  await session.send('Profiler.start');
  for (const gesture of ['model', 'cube']) {
    await page.getByTestId('viewcube-navigation').locator('.home-view').click();
    await page.waitForTimeout(600);
    const box = await page.locator(gesture === 'cube' ? '.view-cube__stage' : 'canvas').first().boundingBox();
    const x = box.x + box.width * .45, y = box.y + box.height * .6;
    await page.evaluate(() => {
      globalThis.__navigationProbe = { samples: [], active: true };
      const probe = globalThis.__navigationProbe;
      const tick = t => { if (!probe.active) return; const p = globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint(); probe.samples.push({ t, position: p.position }); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 90; i++) {
      await page.mouse.move(x + Math.sin(i / 22) * 75, y + Math.cos(i / 25) * 32);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    const release = await page.evaluate(() => performance.now());
    await page.waitForTimeout(700);
    const samples = await page.evaluate(() => { globalThis.__navigationProbe.active = false; return globalThis.__navigationProbe.samples; });
    const intervals = samples.slice(1).map((s, i) => s.t - samples[i].t).sort((a,b)=>a-b);
    const moving = samples.slice(1).filter((s, i) => Math.hypot(s.position.x - samples[i].position.x, s.position.y - samples[i].position.y, s.position.z - samples[i].position.z) > 1e-6);
    const tail = moving.filter(s=>s.t>release+25);
    const settleTimeMs = tail.length ? tail.at(-1).t - release : 0;
    result.tests.push({ gesture, frames: samples.length, meanIntervalMs: intervals.reduce((a,b)=>a+b,0)/intervals.length, p95IntervalMs: intervals[Math.floor(intervals.length*.95)], longFrames: intervals.filter(t=>t>25).length, movingFrames: moving.length, movingFramesAfterRelease: tail.length, settleTimeMs });
    if (process.env.PROFILE_LABEL && process.env.PROFILE_LABEL !== 'baseline') {
      assert.ok(tail.length > 1, 'Orbit continues smoothly between pointer samples and after release');
      assert.ok(settleTimeMs < 600, 'Damping settles promptly instead of drifting');
    }
  }
  const { profile: cpu } = await session.send('Profiler.stop');
  await writeFile(join(reportDir, `navigation-${process.env.PROFILE_LABEL || 'baseline'}.cpuprofile`), JSON.stringify(cpu));
  const nodeMap = new Map(cpu.nodes.map(n=>[n.id,n]));
  const count = new Map(); for(const id of cpu.samples || []) { const n=nodeMap.get(id); const key=`${n.callFrame.functionName} ${n.callFrame.url}:${n.callFrame.lineNumber}`; count.set(key,(count.get(key)||0)+1); }
  result.hotspots = Array.from(count, ([name,samples])=>({name,samples})).sort((a,b)=>b.samples-a.samples).slice(0,15);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.failure = error.stack;
  if (page) await page.screenshot({ path: join(reportDir, `navigation-${process.env.PROFILE_LABEL || 'baseline'}-failure.png`) });
  throw error;
} finally {
  await writeFile(join(reportDir, `navigation-${process.env.PROFILE_LABEL || 'baseline'}.json`), JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
