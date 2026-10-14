/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const desktop = dirname(fileURLToPath(import.meta.url));
const reports = join(desktop, 'reports');
await mkdir(reports, { recursive: true });
const server = createServer();
await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
const port = server.address().port;
await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-oled-'));
const child = spawn(process.env.SMOKE_EXE || join(desktop, 'src-tauri/target/release/ifc-lite-desktop.exe'), [], {
  windowsHide: true,
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run` },
  stdio: 'inherit',
});
let launchError;
child.on('error', error => { launchError = error; });
let browser, page;
const report = { runtime: process.env.OLED_PACKAGED === '1' ? 'Desktop WebView2 / packaged frontend' : 'Desktop WebView2 / dev frontend', checks: [], errors: [] };
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  report.checks.push(name);
};
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
  if (!ready) throw new Error('WebView2 endpoint did not open');
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts().flatMap(context => context.pages())[0];
  assert.ok(page, 'Desktop page exists');
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  if (process.env.OLED_PACKAGED !== '1') await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:3000/');
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 60000 });
  report.url = page.url();
  if (process.env.OLED_PACKAGED === '1') check('Uses embedded frontend', new URL(page.url()).hostname, 'tauri.localhost');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ifc-lite:open-settings')));
  const dialog = page.locator('[data-settings-dialog]');
  await dialog.getByText('Black OLED', { exact: true }).click();
  check('Settings chooses and persists OLED', await page.evaluate(() => ({
    theme: globalThis.__ifc_lite_viewer_store__.getState().theme,
    saved: localStorage.getItem('ifc-lite-theme'),
    classes: ['dark', 'oled', 'colorful'].map(name => document.documentElement.classList.contains(name)),
  })), { theme: 'oled', saved: 'oled', classes: [true, true, false] });
  await expect.poll(() => dialog.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
  check('Settings dialog is black', await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
  await page.screenshot({ path: join(reports, 'oled-settings.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const surfaces = await page.evaluate(() => {
    const style = selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const css = getComputedStyle(element);
      return { background: css.backgroundColor, scheme: css.colorScheme, scroll: css.scrollbarColor };
    };
    return { body: style('body'), activity: style('[data-activity-bar]'),
      left: style('#left-panel'), welcome: style('[data-tour="empty-state-card"]') };
  });
  report.surfaces = surfaces;
  for (const [name, css] of Object.entries(surfaces)) {
    check(`${name} dark native controls`, css.scheme, 'dark');
    check(`${name} dark scrollbar`, css.scroll, 'rgb(64, 64, 64) rgb(0, 0, 0)');
  }
  check('body black', surfaces.body.background, 'rgb(0, 0, 0)');
  check('welcome black', surfaces.welcome.background, 'rgb(0, 0, 0)');
  await page.screenshot({ path: join(reports, 'oled-empty.png') });
  await page.reload();
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__);
  check('Reload restores OLED', await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().theme), 'oled');
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().toggleTheme());
  check('OLED shortcut switches to light', await page.evaluate(() => ({
    theme: globalThis.__ifc_lite_viewer_store__.getState().theme,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    dark: document.documentElement.classList.contains('dark'),
    oled: document.documentElement.classList.contains('oled'),
  })), { theme: 'light', scheme: 'light', dark: false, oled: false });
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().toggleTheme());
  check('Shortcut returns to OLED', await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().theme), 'oled');
  await page.locator('#file-input-open').setInputFiles(resolve(desktop, '../apps/viewer/public/samples/building-architecture.ifc'));
  await page.waitForFunction(() => Array.from(globalThis.__ifc_lite_viewer_store__.getState().models.values()).some(model => model.geometryResult?.meshes?.length), null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  const scrolling = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => {
    const css = getComputedStyle(el);
    return el.getBoundingClientRect().width > 0 && /auto|scroll/.test(css.overflowX + css.overflowY);
  }).map(el => {
    const css = getComputedStyle(el);
    return { tag: el.tagName, classes: String(el.className), scheme: css.colorScheme, scroll: css.scrollbarColor };
  }));
  report.scrolling = scrolling;
  check('All visible scrolling surfaces use dark controls', scrolling.every(css => css.scheme === 'dark'), true);
  check('All visible scrolling surfaces use dark scrollbars', scrolling.every(css => css.scroll === 'rgb(64, 64, 64) rgb(0, 0, 0)'), true);
  report.whiteSurfaces = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => {
    const bounds = el.getBoundingClientRect();
    return bounds.width > 10 && bounds.height > 2 && getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)';
  }).map(el => ({ tag: el.tagName, classes: String(el.className), role: el.getAttribute('role') })));
  check('Loaded model chrome has no white surfaces', report.whiteSurfaces, []);
  await page.screenshot({ path: join(reports, 'oled-model.png') });
  check('IFC loads with OLED active', await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().theme), 'oled');
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().setTheme('dark'));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(26, 27, 38)');
  check('Existing Dark palette still available', await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(26, 27, 38)');
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().setTheme('colorful'));
  check('Colorful clears OLED class', await page.evaluate(() => document.documentElement.classList.contains('oled')), false);
  check('No page errors', report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  if (page) await page.screenshot({ path: join(reports, 'oled-failure.png') });
  throw error;
} finally {
  await writeFile(join(reports, 'oled-theme-smoke.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
