import { expect, test } from "@playwright/test";

const hash = process.env.IFC_E2E_DIAG_HASH;
const bytes = Number(process.env.IFC_E2E_DIAG_BYTES || 0);

test("diagnose native geometry load stages for a local IFC", async ({ page }, testInfo) => {
  test.skip(!hash || !bytes, "Set IFC_E2E_DIAG_HASH and IFC_E2E_DIAG_BYTES");
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).__viewer = event.detail; });
    window.addEventListener("ifc-fragment-metrics", (event: any) => { (window as any).__metrics = event.detail; });
  });
  await page.goto("/?viewerDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewer))).toBe(true);
  await page.evaluate(async ({ hash, bytes }) => {
    const root = window as any;
    root.__stages = [];
    const { EngineV2PageRenderer } = await import(/* @vite-ignore */ "/src/lib/engine-v2/page-renderer.ts");
    const { EngineV2PlannerClient } = await import(/* @vite-ignore */ "/src/lib/engine-v2/planner-client.ts");
    const trace = (proto: any, method: string) => {
      const original = proto[method];
      proto[method] = async function(...args: any[]) {
        const start = performance.now();
        try { return await original.apply(this, args); }
        finally { root.__stages.push({ method, milliseconds: performance.now() - start,
          pages: this.pages?.size, totalPages: this.plan?.pages.length, at: performance.now() }); }
      };
    };
    trace(EngineV2PlannerClient.prototype, "initialize");
    trace(EngineV2PlannerClient.prototype, "buildPage");
    trace(EngineV2PageRenderer.prototype, "uploadPage");
    trace(EngineV2PageRenderer.prototype, "update");
    root.__started = performance.now();
    root.__loadDone = false;
    void root.__viewer.load({ name: "diagnostic.ifc", size: bytes, modelHash: hash, origin: "desktop" })
      .then(() => { root.__loadDone = true; }, (error: Error) => { root.__loadDone = error.name + ": " + error.message; });
  }, { hash, bytes });
  await expect.poll(() => page.evaluate(() => (window as any).__loadDone), { timeout: 240_000, intervals: [1000, 2000, 5000] }).not.toBe(false);
  const result = await page.evaluate(() => {
    const root = window as any;
    const model = root.__viewer.model;
    return { outcome: root.__loadDone, elapsed: performance.now() - root.__started,
      stages: root.__stages, metrics: root.__metrics,
      planPages: model?.renderer?.plan?.pages.length,
      residentPages: model?.renderer?.pages?.size,
      drawnChildren: model?.object?.children.length,
      diagnostics: model?.renderer?.diagnostics };
  });
  await page.screenshot({ path: "../benchmarks/results/ifc-temp-diagnosis-20260924/gian_nang/browser.png" });
  console.log(JSON.stringify(result));
  await testInfo.attach("native-load-diagnosis", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.outcome).toBe(true);
  expect(result.residentPages).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("failed IFC preserves the visible GIAN NANG document", async ({ page }) => {
  const supported = process.env.IFC_E2E_DIAG_FILE;
  const unsupported = process.env.IFC_E2E_DIAG_UNSUPPORTED;
  test.skip(!supported || !unsupported, "Set IFC_E2E_DIAG_FILE and IFC_E2E_DIAG_UNSUPPORTED");
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).__viewer = event.detail; });
    window.addEventListener("ifc-fragment-metrics", (event: any) => { (window as any).__metrics = event.detail; });
  });
  await page.goto("/?viewerDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewer))).toBe(true);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(supported!);
  await expect.poll(() => page.evaluate(() => (window as any).__viewer?.model?.engine), { timeout: 120_000 }).toBe("engine-v2");
  await page.screenshot({ path: "../benchmarks/results/ifc-temp-diagnosis-20260924/gian_nang/before-error.png" });
  const before = await page.evaluate(() => {
    const model = (window as any).__viewer.model;
    return { hash: (window as any).__viewer.modelHash, visible: model.object.visible, pages: model.renderer.pages.size };
  });
  await input.setInputFiles(unsupported!);
  await expect(page.getByRole("alert")).toContainText("Engine V2 chưa hỗ trợ hình học", { timeout: 60_000 });
  await page.screenshot({ path: "../benchmarks/results/ifc-temp-diagnosis-20260924/gian_nang/after-error.png" });
  const after = await page.evaluate(() => {
    const model = (window as any).__viewer.model;
    return { hash: (window as any).__viewer.modelHash, visible: model.object.visible, pages: model.renderer.pages.size };
  });
  console.log(JSON.stringify({ before, after }));
  expect(after).toEqual(before);
});

test("new native profile families open local IFC files", async ({ page }) => {
  const source = process.env.IFC_E2E_DIAG_OPEN;
  test.skip(!source, "Set IFC_E2E_DIAG_OPEN to an IFC source");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  if (source!.toLowerCase().includes("maisanh")) await page.setViewportSize({ width: 945, height: 873 });
  await page.addInitScript(() => {
    window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).__viewer = event.detail; });
    window.addEventListener("ifc-fragment-metrics", (event: any) => { (window as any).__metrics = event.detail; });
  });
  await page.goto("/?viewerDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewer))).toBe(true);
  await page.locator('input[type="file"]').setInputFiles(source!);
  await expect.poll(() => page.evaluate(() => (window as any).__viewer?.model?.engine), { timeout: 90_000 }).toBe("engine-v2");
  await expect.poll(() => page.evaluate(() => (window as any).__viewer?.model?.renderer?.pages?.size), { timeout: 90_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__metrics)), { timeout: 90_000 }).toBe(true);
  if (source!.toLowerCase().includes("maisanh")) await page.evaluate(() => (window as any).__viewer.setBackground("oled"));
  const state = await page.evaluate(() => ({
    pages: (window as any).__viewer.model.renderer.pages.size,
    plannedPages: (window as any).__viewer.model.renderer.plan.pages.length,
    triangles: (window as any).__viewer.model.renderer.diagnostics.sourceTriangles,
    expandedTriangles: (window as any).__viewer.model.renderer.plan.expandedTriangles,
    visible: (window as any).__viewer.model.object.visible,
    loadMilliseconds: (window as any).__metrics.totalMilliseconds,
  }));
  await page.screenshot({ path: `../benchmarks/results/ifc-temp-diagnosis-20260924/${source!.toLowerCase().includes("tthc") ? "tthc" : "maisanh"}-browser.png` });
  console.log(JSON.stringify({ source, state }));
  expect(state.visible).toBe(true);
  expect(state.triangles).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
