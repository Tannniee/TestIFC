import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + process.env.DIAG_PORT);
const page = browser.contexts()[0].pages()[0];
console.log(JSON.stringify(await page.evaluate(() => {
  const s = globalThis.__ifc_lite_viewer_store__.getState();
  return { nativeRuntime: !!globalThis.__IFCLITE_NATIVE__, progress: s.progress,
    geometryProgress: s.geometryProgress, metadataProgress: s.metadataProgress,
    console: document.body.innerText.slice(-1500), native: globalThis.__acceptNative };
}), null, 2));
await page.screenshot({ path: import.meta.dirname + '/live-progress.png' });
if (process.env.CANCEL_TEST === '1') {
  const start = performance.now();
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await page.waitForFunction(() => !globalThis.__ifc_lite_viewer_store__.getState().loading, null, { timeout: 30000 });
  const result = { cancelledByRealClick: true, milliseconds: performance.now() - start,
    state: await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      return { loading: s.loading, error: s.error, models: s.models.size, progress: s.progress };
    }) };
  await writeFile(import.meta.dirname + '/packaged-cancel.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await page.screenshot({ path: import.meta.dirname + '/cancelled.png' });
  await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
}
process.exit(0);
