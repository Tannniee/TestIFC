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
const result = { executable: exe, runtimeUrl: process.env.PANEL_URL || 'embedded', tests: [], errors, diagnostics };
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
  if (process.env.PANEL_URL) { await page.goto(process.env.PANEL_URL); await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 120000 }); }
  if (!process.env.DOCK_EMPTY) {
    await page.locator('#file-input-open').setInputFiles(resolve(desktop, '../apps/viewer/public/samples/building-architecture.ifc'));
    await page.waitForFunction(() => Array.from(globalThis.__ifc_lite_viewer_store__.getState().models.values()).some(m => m.geometryResult?.meshes?.length), null, { timeout: 120000 });
  }
  await page.waitForTimeout(1000);
  if (process.env.DOCK_MOTION) {
    const dockProfiler = await page.context().newCDPSession(page);
    await dockProfiler.send('Profiler.enable');
    await dockProfiler.send('Profiler.start');
    result.dock = [];
    async function recordDock(name, locator, side, expectMotion = !!process.env.EXPECT_DOCK_MOTION) {
      await page.evaluate(() => {
        const widths = () => {
          const rail = document.querySelector('[data-activity-bar]');
          return { left: document.getElementById('left-panel').getBoundingClientRect().width,
            right: rail.parentElement.getBoundingClientRect().width - rail.getBoundingClientRect().width };
        };
        globalThis.__dockFrames = [];
        globalThis.__dockUntil = performance.now() + 1000;
        const sample = time => {
          globalThis.__dockFrames.push({time, ...widths()});
          if (time < globalThis.__dockUntil) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await locator.click();
      await page.waitForTimeout(650);
      const frames = await page.evaluate(() => { globalThis.__dockUntil = 0; return globalThis.__dockFrames; });
      const deltas = frames.slice(1).map((frame, i) => frame.time - frames[i].time).sort((a,b)=>a-b);
      const moving = frames.slice(1).filter((frame,i)=>Math.abs(frame[side]-frames[i][side])>.1);
      const start = frames[0][side], end = frames.at(-1)[side];
      const middle = frames.filter(frame=>frame[side] > Math.min(start,end)+1 && frame[side] < Math.max(start,end)-1);
      const report = {name, start, end, intermediateFrames:middle.length,
        motionMs:moving.length > 1 ? moving.at(-1).time-moving[0].time : 0,
        frameP95Ms:deltas[Math.floor(deltas.length*.95)], frameMaxMs:Math.max(...deltas),
        framesOver25Ms:deltas.filter(delta=>delta>25).length};
      result.dock.push(report);
      if (expectMotion) {
        assert.ok(middle.length >= 3, `${name} must interpolate the actual dock width`);
        assert.ok(report.motionMs >= 150 && report.motionMs < 600, `${name} must have a bounded smooth transition`);
      }
    }
    const hierarchy = page.locator('[data-tour="activity-hierarchy"]');
    const properties = page.locator('[data-tour="activity-properties"]');
    await recordDock('close Hierarchy', hierarchy, 'left');
    await recordDock('open Hierarchy', hierarchy, 'left');
    const retainedPanel = process.env.EXPECT_DOCK_MOTION
      ? await page.locator('.viewer-sidebar-reveal [data-detach-root]').elementHandle() : null;
    await recordDock('close Properties dock',page.getByRole('button',{name:'Collapse sidebar to icons',exact:true}),'right');
    if (retainedPanel) {
      assert.ok(await retainedPanel.evaluate(element=>element.isConnected),'Closing the dock preserves its mounted panel');
      assert.equal(await page.locator('.viewer-sidebar-reveal').getAttribute('inert'),'');
      assert.equal(await page.locator('.viewer-sidebar-reveal').getAttribute('aria-hidden'),'true');
    }
    await recordDock('open Properties dock',properties,'right');
    if (retainedPanel) assert.ok(await retainedPanel.evaluate(element=>element.isConnected),'Reopening retains the same panel');
    const { profile: dockCpuProfile } = await dockProfiler.send('Profiler.stop');
    await writeFile(join(reportDir,`panels-${process.env.PANEL_LABEL || 'dock'}.cpuprofile`), JSON.stringify(dockCpuProfile));
    if (process.env.EXPECT_DOCK_MOTION) {
      // Reversals while the width is still moving must end at the requested state.
      for (let i=0;i<3;i++) { await hierarchy.click(); await page.waitForTimeout(35); await hierarchy.click(); }
      await page.waitForTimeout(450);
      assert.equal(await hierarchy.getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:'Collapse sidebar to icons',exact:true}).click();
      await page.waitForTimeout(35);
      await properties.click();
      await page.waitForTimeout(450);
      assert.equal(await properties.getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.viewer-sidebar-reveal').getAttribute('data-dock-state'),'expanded');
      assert.equal(await page.locator('.viewer-sidebar-reveal').getAttribute('inert'),null);
      await page.emulateMedia({reducedMotion:'reduce'});
      const startIndex = result.dock.length;
      await recordDock('reduced motion close Hierarchy',hierarchy,'left',false);
      await recordDock('reduced motion open Hierarchy',hierarchy,'left',false);
      await recordDock('reduced motion close Properties',page.getByRole('button',{name:'Collapse sidebar to icons',exact:true}),'right',false);
      await recordDock('reduced motion open Properties',properties,'right',false);
      for (const motion of result.dock.slice(startIndex)) assert.equal(motion.intermediateFrames,0);
      await page.emulateMedia({reducedMotion:'no-preference'});
      // Resizing uses the current pointer position, without the toggle tween.
      const resizeHandle = page.getByRole('separator',{name:'Resize sidebar',exact:true});
      const box = await resizeHandle.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.down();
      await page.mouse.move(box.x-45,box.y+box.height/2,{steps:4});
      assert.equal(await page.locator('.viewer-sidebar-reveal').evaluate(element=>getComputedStyle(element).transitionDuration),'0s');
      const resized = await page.locator('.viewer-sidebar-reveal').evaluate(element=>element.getBoundingClientRect().width);
      await page.mouse.up();
      await page.waitForTimeout(350);
      const committed = await page.locator('.viewer-sidebar-reveal').evaluate(element=>element.getBoundingClientRect().width);
      assert.ok(Math.abs(resized-committed)<2,'Releasing the divider keeps its width');
      result.tests.push({name:'retained panel, rapid dock reversal, reduced motion and direct divider resizing',passed:true});
    }
  } else {
  result.inventory = await page.evaluate(() => ({ tabs: Array.from(document.querySelectorAll('[role=tab]'), e=>({ text:e.textContent, label:e.getAttribute('aria-label') })), trees:Array.from(document.querySelectorAll('[role=treeitem]'), e=>({ text:e.textContent, type:e.dataset.hierarchyNodeType, expanded:e.getAttribute('aria-expanded') })), panels:Array.from(document.querySelectorAll('[data-panel-group]'), e=>({ text:e.textContent, label:e.getAttribute('aria-label'), title:e.getAttribute('title'), group:e.dataset.panelGroup })) }));
  await page.evaluate(() => {
    globalThis.__panelMotionEvents = [];
    for (const type of ['animationstart','transitionrun']) document.addEventListener(type, e=>globalThis.__panelMotionEvents.push({type, target:e.target.className, name:e.animationName || e.propertyName, duration:getComputedStyle(e.target).animationDuration}));
  });
  const animations = () => page.evaluate(() => document.getAnimations().map(a => ({name:a.animationName || a.constructor.name, kind:a.constructor.name, target:a.effect?.target?.className, duration:a.effect?.getTiming().duration, role:a.effect?.target?.getAttribute('role'), frames:a.effect?.getKeyframes().map(k=>({transform:k.transform,opacity:k.opacity,height:k.height}))})));
  async function record(name, locator) {
    await locator.click();
    result.tests.push({name, animations:await animations()});
    await page.waitForTimeout(220);
  }
  await record('expand hierarchy branch', page.locator('.hierarchy-item[aria-expanded="false"]').first().getByRole('button',{name:/^Expand /}));
  await record('collapse hierarchy branch', page.locator('.hierarchy-item[aria-expanded="true"]').filter({hasText:'Single-family'}).getByRole('button',{name:/^Collapse /}));
  await page.locator('.hierarchy-item[data-hierarchy-node-type="element"]').filter({hasText:'origin'}).click();
  await page.waitForTimeout(250);
  await record('Properties quantities tab',page.getByRole('tab',{name:'Quantities',exact:true}));
  await record('Properties tab',page.getByRole('tab',{name:'Properties',exact:true}));
  const attributes = page.locator('[data-tour="properties-panel"]').getByRole('button',{name:/Attributes/});
  await record('close attributes group',attributes);
  await record('open attributes group',attributes);
  await record('open model inspector',page.locator('[data-tour="activity-model"]'));
  await record('open Properties panel',page.locator('[data-tour="activity-properties"]'));
  if(process.env.PANEL_URL) {
    for(const test of result.tests) {
      assert.ok(test.animations.some(a => ['viewer-panel-enter','viewer-disclosure-open','viewer-disclosure-close'].includes(a.name) || (a.role==='treeitem' && a.kind==='Animation')), `Missing content animation: ${test.name}`);
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await record('reduced motion Properties quantities tab',page.getByRole('tab',{name:'Quantities',exact:true}));
    assert.ok(!result.tests.at(-1).animations.some(a=>a.name.startsWith('viewer-')));
    await record('reduced motion hierarchy branch',page.locator('.hierarchy-item[aria-expanded="false"]').first().getByRole('button',{name:/^Expand /}));
    assert.ok(!result.tests.at(-1).animations.some(a=>a.role==='treeitem' && a.kind==='Animation'));
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(let i=0;i<6;i++) {
      await page.getByRole('tab',{name:'Quantities',exact:true}).click();
      await page.getByRole('tab',{name:'Properties',exact:true}).click();
    }
    assert.equal(await page.getByRole('tab',{name:'Properties',exact:true}).getAttribute('aria-selected'),'true');
    const branch = page.locator('.hierarchy-item').filter({hasText:'Single-family'});
    await branch.focus();
    for(let i=0;i<6;i++) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); }
    assert.equal(await branch.getAttribute('aria-expanded'),'true');
    await page.waitForTimeout(220);
    assert.equal(await branch.getAttribute('aria-expanded'),'true');
    result.tests.push({name:'rapid tab switching and keyboard tree expansion',passed:true});
  }
  result.events = await page.evaluate(() => globalThis.__panelMotionEvents);
  }
  await page.screenshot({path:join(reportDir,`panels-${process.env.PANEL_LABEL || 'before'}.png`)});
  assert.equal(errors.length,0,'No page errors during panel interactions');
  result.passed=true;
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  result.passed=false;
  result.failure=error.stack;
  if(page) await page.screenshot({path:join(reportDir,'panels-failure.png')});
  throw error;
} finally {
  await writeFile(join(reportDir,`panels-${process.env.PANEL_LABEL || 'before'}.json`),JSON.stringify(result,null,2));
  if(browser) await browser.close();
  if(child.pid && child.exitCode===null) spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:500});
}
