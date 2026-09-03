import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/health", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/selection", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
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

test("conversion worker is lazy, terminates on done/cancel/error, and ignores obsolete results", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/src/lib/ifc-converter.ts";
    const { IfcConverter } = await import(path);
    const NativeWorker = window.Worker;
    const workers: any[] = [];
    class FakeWorker extends EventTarget {
      terminated = false;
      request: any;
      constructor() { super(); workers.push(this); }
      postMessage(value: unknown) { this.request = value; }
      terminate() { this.terminated = true; }
      reply(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data })); }
    }
    window.Worker = FakeWorker as any;
    const converter = new IfcConverter("full");
    try {
      const lazy = workers.length;
      const first = converter.convert(new ArrayBuffer(1), () => {}).catch((e: Error) => e.name);
      const a = workers[0];
      converter.cancel();
      const cancelled = await first;
      const second = converter.convert(new ArrayBuffer(1), () => {});
      const b = workers[1];
      a.reply({ type: "done", id: a.request.id, fragments: new Uint8Array([99]) });
      b.reply({ type: "done", id: b.request.id, fragments: new Uint8Array([7]) });
      const bytes = [...await second];
      const third = converter.convert(new ArrayBuffer(1), () => {}).catch((e: Error) => e.message);
      workers[2].dispatchEvent(new ErrorEvent("error", { message: "worker failed" }));
      const error = await third;
      converter.dispose();
      const disposed = await converter.convert(new ArrayBuffer(1), () => {}).then(() => false, () => true);
      return { lazy, cancelled, bytes, error, disposed, count: workers.length, terminated: workers.every(w => w.terminated) };
    } finally { converter.dispose(); window.Worker = NativeWorker; }
  });
  expect(result).toMatchObject({ lazy: 0, bytes: [7], error: "worker failed", disposed: true, count: 3, terminated: true });
  expect(result.cancelled).toBe("LoadCancelledError");
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

test("real IFC cancelled at fragment attachment cannot restore its model and reopens cleanly", async ({ page }) => {
  test.setTimeout(120000);
  const model = process.env.IFC_E2E_MODEL_PATH;
  test.skip(!model, "Set IFC_E2E_MODEL_PATH for the fragment attachment cancellation gate");
  await page.evaluate(async () => {
    const path = "/src/lib/viewer.ts";
    const { ViewerService } = await import(path);
    const original = ViewerService.prototype.load;
    ViewerService.prototype.load = function(file: File) {
      ViewerService.prototype.load = original;
      (window as any).__fragmentViewer = this;
      const fragments = this.loader.fragments;
      const load = fragments.load.bind(fragments);
      fragments.load = async (...args: any[]) => {
        fragments.load = load;
        const loaded = await load(...args);
        (window as any).__attachmentReady = true;
        await new Promise(resolve => { (window as any).__releaseAttachment = resolve; });
        return loaded;
      };
      return original.call(this, file).finally(() => { (window as any).__oldLoadSettled = true; });
    };
  });
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(model!);
  await page.waitForFunction(() => (window as any).__attachmentReady, { timeout: 60000 });
  await page.getByRole("dialog").getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (window as any).__releaseAttachment());
  await page.waitForFunction(() => (window as any).__oldLoadSettled);
  const disposed = await page.evaluate(() => {
    const viewer = (window as any).__fragmentViewer;
    return { model: viewer.hasModel, fragments: viewer.loader.fragments.models.list.size };
  });
  expect(disposed).toEqual({ model: false, fragments: 0 });
  await input.setInputFiles(model!);
  await expect.poll(() => page.evaluate(() => (window as any).__fragmentViewer.hasModel), { timeout: 60000 }).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 60000 });
});
