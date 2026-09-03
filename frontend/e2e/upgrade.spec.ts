import { expect, test } from "@playwright/test";

const modelA = process.env.IFC_E2E_MODEL_A;
const modelB = process.env.IFC_E2E_MODEL_B;

test("transactional A/B loading preserves A on failure/cancel and Section Box clips the committed model", async ({ page }, testInfo) => {
  test.skip(!modelA || !modelB, "Set the two private A/B IFC paths");
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).viewer = event.detail; }));
  await page.goto("/?viewerDebug=1");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
  await page.evaluate(async () => {
    const root = window as any;
    root.metrics = [];
    root.loadResult = "idle";
    window.addEventListener("ifc-fragment-metrics", (event: any) => root.metrics.push(event.detail));
    const load = root.viewer.load;
    root.viewer.load = function(file: File, options: any) {
      root.viewer = this;
      root.loadResult = "loading";
      return load.call(this, file, options).then(() => { root.loadResult = "ready"; }, (error: Error) => {
        root.loadResult = error.name + ":" + error.message;
        throw error;
      });
    };
  });
  const input = page.locator('input[type="file"]');
  const open = async (path: string) => {
    await input.setInputFiles(path);
    await expect.poll(() => page.evaluate(() => (window as any).loadResult), { timeout: 150000 }).toBe("ready");
  };
  await open(modelA!);
  const hashA = await page.evaluate(() => (window as any).metrics[0].modelHash);
  await page.evaluate(() => {
    const root = window as any;
    root.originalA = root.viewer.loader.activeModel;
    root.viewer.fitSectionBox();
    root.originalCamera = JSON.stringify(root.viewer.view.captureState());
    root.originalClipping = JSON.stringify(root.viewer.sectionBox);
  });
  // Fail an actual cache request after the backend has issued a stage lease.
  await page.route("**/model/fragments/**", async route => {
    if (route.request().method() === "GET") await route.fulfill({ status: 500, body: "injected cache read failure" });
    else await route.continue();
  });
  await input.setInputFiles(modelB!);
  await expect.poll(() => page.evaluate(() => (window as any).loadResult)).toContain("injected cache read failure");
  await page.unroute("**/model/fragments/**");
  const preserved = await page.evaluate(async () => {
    const root = window as any;
    return { same: root.originalA === root.viewer.loader.activeModel,
      camera: root.originalCamera === JSON.stringify(root.viewer.view.captureState()),
      clipping: root.originalClipping === JSON.stringify(root.viewer.sectionBox),
      backend: (await (await fetch("/model/runtime")).json()).activeModelHash };
  });
  expect(preserved).toEqual({ same: true, camera: true, clipping: true, backend: hashA });
  // Fail after backend commit and visible handover; A and its clipping must roll back.
  await page.evaluate(() => {
    const v = (window as any).viewer;
    (window as any).originalUpdate = v.loader.callbacks.update;
    v.loader.callbacks.update = async () => { throw new Error("injected final view failure"); };
  });
  await input.setInputFiles(modelB!);
  await expect.poll(() => page.evaluate(() => (window as any).loadResult)).toContain("injected final view failure");
  expect(await page.evaluate(async () => ({
    same: (window as any).viewer.loader.activeModel === (window as any).originalA,
    clipping: JSON.stringify((window as any).viewer.sectionBox) === (window as any).originalClipping,
    backend: (await (await fetch("/model/runtime")).json()).activeModelHash,
    models: (window as any).viewer.loader.fragments.models.list.size,
  }))).toEqual({ same: true, clipping: true, backend: hashA, models: 1 });
  await page.evaluate(() => { (window as any).viewer.loader.callbacks.update = (window as any).originalUpdate; });
  // Hold a cancellable request while exercising the real Cancel button.
  await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    (window as any).originalFragments = api.getFragments;
    api.getFragments = (_: string, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    });
  });
  await input.setInputFiles(modelB!);
  await expect(page.locator("dialog.model-load-dialog")).toBeVisible();
  await page.waitForTimeout(250);
  await page.locator("dialog.model-load-dialog button").click();
  await expect.poll(() => page.evaluate(() => (window as any).loadResult)).toContain("LoadCancelledError");
  await expect.poll(() => page.evaluate(() => (window as any).viewer.loader.activeModel === (window as any).originalA)).toBe(true);
  await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    api.getFragments = (window as any).originalFragments;
  });
  // B is superseded by C (the same IFC bytes as A); only C may finish.
  await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const root = window as any;
    root.heldB = false;
    api.getFragments = (key: string, signal: AbortSignal) => {
      if (key.startsWith(root.metrics[0].modelHash)) return root.originalFragments(key, signal);
      root.heldB = true;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("superseded", "AbortError")), { once: true }));
    };
  });
  await input.setInputFiles(modelB!);
  await expect.poll(() => page.evaluate(() => (window as any).heldB)).toBe(true);
  await open(modelA!);
  await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    api.getFragments = (window as any).originalFragments;
  });
  // Lose the first successful commit reply; retry must reuse exactly one ticket.
  const commitTickets: string[] = [];
  await page.route("**/model/stage/*", async route => {
    if (route.request().postDataJSON()?.action === "commit") {
      commitTickets.push(route.request().url());
      if (commitTickets.length === 1) {
        await route.fetch();
        await route.fulfill({ status: 503, body: "injected lost commit reply" });
        return;
      }
    }
    await route.continue();
  });
  await open(modelB!);
  await page.unroute("**/model/stage/*");
  expect(commitTickets).toHaveLength(2);
  expect(commitTickets[0]).toBe(commitTickets[1]);
  await page.getByRole("button", { name: "Section Box", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).viewer.boxZoomActive)).toBe(true);
  const camera = await page.evaluate(() => {
    const v = (window as any).viewer;
    return { picking: v.sectionBoxPicking, direction: v.camera.position.clone().sub(v.view.controls.target).normalize().toArray() };
  });
  expect(camera.picking).toBe(true);
  expect(camera.direction[1]).toBeCloseTo(1);
  const canvas = (await page.locator(".viewer-mount canvas").boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .3, canvas.y + canvas.height * .3);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .7, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".viewer-section-box-panel")).toBeVisible();
  const box = await page.evaluate(() => {
    const v = (window as any).viewer;
    const box = v.sectionBox;
    const center = v.loader.activeModel.box.getCenter(v.camera.position.clone());
    center.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    return { count: v.renderer.clippingPlanes.length, distances: v.renderer.clippingPlanes.map((p: any) => p.distanceToPoint(center)),
      hookCount: v.loader.activeModel.getClippingPlanesEvent().length };
  });
  expect(box.count).toBe(6);
  expect(box.hookCount).toBe(6);
  expect(box.distances.every((n: number) => n > 0)).toBe(true);
  await page.screenshot({ path: "../benchmarks/results/upgrade-20260903/section-box-light.png" });
  await expect(page.getByRole("tab", { name: "Section Box 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("checkbox", { name: "Bật vùng cắt", exact: true }).uncheck();
  await expect.poll(() => page.evaluate(() => (window as any).viewer.renderer.clippingPlanes.length)).toBe(0);
  await open(modelA!);
  const metrics = await page.evaluate(() => (window as any).metrics);
  expect(metrics).toHaveLength(3);
  expect(metrics[2].modelHash).toBe(hashA);
  expect(metrics[2].cacheHit).toBe(true);
  const final = await page.evaluate(async () => ({
    backend: (await (await fetch("/model/runtime")).json()).activeModelHash,
    models: (window as any).viewer.loader.fragments.models.list.size,
  }));
  expect(final).toEqual({ backend: hashA, models: 1 });
  const transforms = await page.evaluate(() => (window as any).viewer.loader.activeModel.object.position.toArray());
  expect(transforms).toEqual([0, 0, 0]);
  await page.getByRole("button", { name: "Cài đặt hiển thị", exact: true }).click();
  await expect(page.locator(".cache-settings")).toContainText("Fragment:");
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 420, height: 320 });
  await expect(page.locator(".viewer-settings")).toBeInViewport({ ratio: 1 });
  await page.setViewportSize(viewport);
  await page.screenshot({ path: "../benchmarks/results/upgrade-20260903/cache-options-light.png" });
  await page.getByRole("button", { name: "Clear fragment cache", exact: true }).click();
  await expect(page.locator(".cache-settings [role=status]")).toContainText("Đã dọn");
  expect(await page.evaluate(async () => (await (await fetch("/model/runtime")).json()).activeModelHash)).toBe(hashA);
  await page.evaluate(() => document.querySelector(".qn-theme")!.setAttribute("data-mode", "dark"));
  await page.waitForTimeout(400); // Let the existing theme transition finish before visual capture.
  await page.screenshot({ path: "../benchmarks/results/upgrade-20260903/cache-options-dark.png" });
  await page.getByRole("button", { name: "Cài đặt hiển thị", exact: true }).click();
  expect(errors).toEqual([]);
  await testInfo.attach("real-model-upgrade", { body: JSON.stringify({ preserved, camera, box, final, metrics, commitTickets, transforms }, null, 2), contentType: "application/json" });
});
