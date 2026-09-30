import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'reports/mapbox-models');
await mkdir(output, { recursive: true });
const envText = await readFile(path.join(root, 'frontend/.env.local'), 'utf8');
const token = process.env.MAPBOX_TEST_TOKEN || envText.match(/^VITE_MAPBOX_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
const port = Number(process.env.MAPBOX_MODEL_PORT || 4178);
const host = spawn(path.join(root, '.venv/Scripts/python.exe'), ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', 'frontend/public'], { cwd: root, windowsHide: true, stdio: 'ignore' });
const files = process.argv.slice(2);
const results = [];
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/vendor/bim-gis/index.html`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  for (const file of files) {
    const name = path.basename(file), hash = createHash('sha256').update(await readFile(file)).digest('hex');
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().replace(/pk\.[A-Za-z0-9._-]+/g, '[token]').replace(/access_token=[^&\s]+/g, 'access_token=[redacted]')); });
    await page.addInitScript(() => {
      window.__modelEvents = [];
      window.addEventListener('message', event => {
        if (event.origin === location.origin && event.data?.channel === 'testifc-bim-gis-v1' && !['token', 'document'].includes(event.data.type)) window.__modelEvents.push(event.data);
      });
    });
    await page.goto(`http://127.0.0.1:${port}/vendor/bim-gis/index.html`);
    await page.waitForFunction(() => window.__modelEvents.some(event => event.type === 'ready'));
    await page.evaluate(token => window.postMessage({ channel: 'testifc-bim-gis-v1', type: 'token', token }, location.origin), token);
    await page.waitForFunction(() => window.__modelEvents.some(event => event.type === 'map-ready'), null, { timeout: 45000 });
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'test-file'; document.body.append(input); });
    await page.locator('#test-file').setInputFiles(file);
    const started = Date.now();
    await page.evaluate(hash => window.postMessage({ channel: 'testifc-bim-gis-v1', type: 'document', hash, file: document.getElementById('test-file').files[0] }, location.origin), hash);
    await page.waitForFunction(() => window.__modelEvents.some(event => ['model-ready', 'model-error'].includes(event.type)), null, { timeout: 240000 });
    const event = await page.evaluate(() => window.__modelEvents.find(event => ['model-ready', 'model-error'].includes(event.type)));
    const readyMs=Date.now()-started;
    expect(event.type, `${name} must convert successfully`).toBe('model-ready');
    expect(Math.max(...Object.values(event.bounds))).toBeGreaterThan(0);
    await page.evaluate(() => window.postMessage({ channel: 'testifc-bim-gis-v1', type: 'fly' }, location.origin));
    await page.waitForTimeout(4000);
    const diagnostics = await page.locator('html').evaluate(element => ({ ...element.dataset }));
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    expect(Number(diagnostics.renderedTriangles), `${name} must actually draw`).toBeGreaterThan(0);
    if(name==='CECO.ifc') {
      expect(Number(diagnostics.deferredTriangles)).toBeGreaterThan(50_000_000);
      await page.locator('.mapboxgl-ctrl-zoom-in').click();
      await page.waitForTimeout(2000);
      const after=Number(await page.locator('html').getAttribute('data-deferred-triangles'));
      expect(after,'zooming closer must restore fine geometry').toBeLessThan(Number(diagnostics.deferredTriangles));
      diagnostics.deferredAfterZoom=String(after);
    }
    expect(errors).toEqual([]);
    const result = { name, readyMs, elapsedMs: Date.now() - started, event, diagnostics, errors };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  if (host.exitCode === null) host.kill();
}
