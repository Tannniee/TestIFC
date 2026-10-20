/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = dirname(fileURLToPath(import.meta.url));

/** Trusted Chromium file drops: synthetic dispatchEvent misses React's native event ordering. */
export async function testModelSceneDrops(page, result, reportDir) {
  const bytes = await readFile(join(desktop, '../apps/viewer/public/samples/building-architecture.ifc'));
  const input = page.locator('#file-input-open');
  const file = name => ({ name, mimeType: 'application/octet-stream', buffer: bytes });
  const state = () => page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return { loading: s.loading, error: s.loadError,
      models: [...s.models.values()].map(m => ({ id: m.id, name: m.name, loadPath: m.loadPath, meshes: m.geometryResult?.meshes?.length ?? 0 })) };
  });
  const waitFor = async names => {
    await page.waitForFunction(expected => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      const models = [...s.models.values()];
      return !s.loading && !s.loadError && models.length === expected.length
        && expected.every(name => models.some(m => m.name === name && m.geometryResult?.meshes?.length > 0));
    }, names, { timeout: 60000 });
    await page.waitForTimeout(250);
  };

  // A fresh page is required so these names describe the whole scene.
  await input.setInputFiles(file('drop-original.ifc'));
  await waitFor(['drop-original.ifc']);
  const original = (await state()).models[0];
  const cdp = await page.context().newCDPSession(page);

  async function drop(names, action, screenshot) {
    const files = names.map(name => join(reportDir, name));
    await Promise.all(files.map(path => writeFile(path, bytes)));
    const data = { items: [], files, dragOperationsMask: 1 };
    const canvas = page.locator('canvas[data-viewport="main"]');
    const viewport = await canvas.boundingBox();
    assert.ok(viewport);
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: viewport.x + 20, y: viewport.y + 20, data });
    const card = page.locator(`[data-model-drop-action="${action}"]`);
    await card.waitFor();
    const box = await card.boundingBox();
    assert.ok(box);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // The overlay deliberately passes native events through to the window.
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', data, ...point });
    await page.waitForFunction(target => document.querySelector(`[data-model-drop-action="${target}"]`)?.classList.contains('ring-2'), action);
    if (screenshot) {
      await page.waitForTimeout(250); // let the target highlight transition settle
      await page.screenshot({ path: join(reportDir, screenshot) });
    }
    assert.ok(await card.isVisible(), 'the chosen target is visible before the native drop');
    await page.evaluate(() => {
      globalThis.__modelDropEvidence = null;
      window.addEventListener('drop', event => {
        globalThis.__modelDropEvidence = { trusted: event.isTrusted,
          cardMounted: !!document.querySelector('[data-model-drop-action="replace"]') };
      }, { capture: true, once: true });
    });
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', data, ...point });
    const evidence = await page.evaluate(() => globalThis.__modelDropEvidence);
    assert.equal(evidence?.trusted, true);
    await page.waitForFunction(() => !document.querySelector('[data-model-drop-action]'));
    return evidence;
  }

  try {
    const addEvent = await drop(['drop-added.ifc'], 'add', 'model-drop-add.png');
    await waitFor(['drop-original.ifc', 'drop-added.ifc']);
    assert.ok((await state()).models.some(m => m.id === original.id), 'add retains the original model');
    result.tests.push({ name: 'upper drop card adds a real IFC while retaining the original', event: addEvent, ...(await state()) });

    const replaceEvent = await drop(['drop-replacement.ifc'], 'replace', 'model-drop-replace.png');
    await waitFor(['drop-replacement.ifc']);
    assert.ok((await state()).models.every(m => m.id !== original.id), 'replace removes the original model');
    result.tests.push({ name: 'lower drop card replaces the entire federation with a real IFC', event: replaceEvent, ...(await state()) });

    const batchEvent = await drop(['drop-batch-a.ifc', 'drop-batch-b.ifc'], 'replace');
    await waitFor(['drop-batch-a.ifc', 'drop-batch-b.ifc']);
    result.tests.push({ name: 'lower drop card replaces a single model with a new two-model federation', event: batchEvent, ...(await state()) });
    await page.screenshot({ path: join(reportDir, 'model-drop-result.png') });
  } finally { await cdp.detach(); }
}
