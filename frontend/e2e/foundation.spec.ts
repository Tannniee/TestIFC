import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/health", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/selection", route => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).__fragmentViewer = event.detail; }));
  await page.goto("/?viewerDebug=1");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
});

test("viewer sleeps at rest and redraws UI changes and animated camera moves", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/src/lib/viewer.ts";
    const { ViewerService } = await import(path);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;width:400px;height:300px;top:0;left:0";
    document.body.append(host);
    const viewer = new ViewerService(host, new Proxy({}, { get: () => () => {} }));
    const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await pause(400);
      const idle = viewer.scheduler.frames;
      await pause(400);
      const afterIdle = viewer.scheduler.frames;
      viewer.setGridVisible(false);
      viewer.setBackground("white");
      await pause(100);
      const changed = viewer.scheduler.frames;
      const before = (viewer.camera.top - viewer.camera.bottom) / viewer.camera.zoom;
      viewer.view.zoomToViewportBox(100, 75, 200, 150, 400, 300);
      await pause(1000);
      const animated = viewer.scheduler.frames;
      const zoom = (viewer.camera.top - viewer.camera.bottom) / viewer.camera.zoom;
      await pause(400);
      return { idle, afterIdle, changed, animated, final: viewer.scheduler.frames, before, zoom };
    } finally { await viewer.dispose(); host.remove(); }
  });
  expect(result.afterIdle).toBe(result.idle);
  expect(result.changed).toBeGreaterThan(result.idle);
  expect(result.animated).toBeGreaterThan(result.changed + 2);
  expect(result.zoom).toBeLessThan(result.before);
  expect(result.final).toBe(result.animated);
});

test("native loader cancels a browser upload before staging a model", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const viewer = (window as any).__fragmentViewer;
    const originalUpload = api.uploadModel;
    let started!: () => void;
    const uploadStarted = new Promise<void>(resolve => { started = resolve; });
    api.uploadModel = (_file: File, _progress: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      started();
      signal.addEventListener("abort", () => reject(new DOMException("Upload cancelled", "AbortError")), { once: true });
    });
    try {
      const file = new File(["x"], "small.ifc");
      const loading = viewer.load({ name: file.name, size: file.size, file, origin: "browser" })
        .then(() => "loaded", (error: Error) => error.name);
      await uploadStarted;
      await viewer.cancelLoad();
      return { outcome: await loading, hasModel: viewer.hasModel, hasFragments: "fragments" in viewer.loader };
    } finally { api.uploadModel = originalUpload; }
  });
  expect(result).toEqual({ outcome: "LoadCancelledError", hasModel: false, hasFragments: false });
});

test("authenticated transport snapshots upload bytes before asynchronous desktop session lookup", async ({ page }) => {
  let payload: Buffer | null = null;
  await page.route("**/session-transfer-test", async route => {
    payload = route.request().postDataBuffer();
    await route.fulfill({ body: "ok" });
  });
  const length = await page.evaluate(async () => {
    const path = "/src/lib/session-transport.ts";
    const { sessionFetch } = await import(path);
    const bytes = new Uint8Array([3, 1, 4, 1, 5]);
    const upload = sessionFetch("/session-transfer-test", { method: "POST", body: bytes });
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    await upload;
    return bytes.byteLength;
  });
  expect(length).toBe(0);
  expect(payload).toEqual(Buffer.from([3, 1, 4, 1, 5]));
});

test("real IFC cancelled at native attachment leaves no model and reopens cleanly", async ({ page }) => {
  test.setTimeout(120000);
  const model = process.env.IFC_E2E_MODEL_PATH;
  test.skip(!model, "Set IFC_E2E_MODEL_PATH for the native attachment cancellation gate");
  await page.evaluate(async () => {
    const viewer = (window as any).__fragmentViewer;
    (window as any).__cancelTrace = [];
    for (const name of ["applyViewState", "clearSelection"]) {
      const originalStep = viewer[name].bind(viewer);
      viewer[name] = async (...args: any[]) => {
        (window as any).__cancelTrace.push(`${name}:start`);
        try { return await originalStep(...args); }
        finally { (window as any).__cancelTrace.push(`${name}:end`); }
      };
    }
    const original = viewer.load;
    viewer.load = function(file: File, options: any) {
      viewer.load = original;
      (window as any).__fragmentViewer = this;
      const callbacks = this.loader.callbacks;
      const attach = callbacks.attach;
      callbacks.attach = async (...args: any[]) => {
        callbacks.attach = attach;
        await attach(...args);
        (window as any).__attachmentReady = true;
        await new Promise(resolve => { (window as any).__releaseAttachment = resolve; });
      };
      return original.call(this, file, options).finally(() => { (window as any).__oldLoadSettled = true; });
    };
  });
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(model!);
  await page.waitForFunction(() => (window as any).__attachmentReady, undefined, { timeout: 60000 });
  await page.getByRole("dialog").getByRole("button", { name: "Hủy", exact: true }).click();
  await page.evaluate(() => (window as any).__releaseAttachment());
  try { await page.waitForFunction(() => (window as any).__oldLoadSettled, undefined, { timeout: 15000 }); }
  catch (error) {
    console.log(await page.evaluate(() => ({ trace: (window as any).__cancelTrace,
      events: (window as any).__fragmentViewer.viewDiagnostics.events.slice(-10),
      hasModel: (window as any).__fragmentViewer.hasModel })));
    throw error;
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const disposed = await page.evaluate(() => {
    const viewer = (window as any).__fragmentViewer;
    return { model: viewer.hasModel, hasFragments: "fragments" in viewer.loader };
  });
  expect(disposed).toEqual({ model: false, hasFragments: false });
  await input.setInputFiles(model!);
  await expect.poll(() => page.evaluate(() => (window as any).__fragmentViewer.hasModel), { timeout: 60000 }).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 60000 });
});
