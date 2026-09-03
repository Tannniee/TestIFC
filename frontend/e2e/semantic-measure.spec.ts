import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.route("**/health", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/selection", route => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).__viewer = event.detail; }));
  await page.goto("/?viewerDebug=1");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
});

test("measurement entry follows its point, with units, signed axis snapping and current-frame labels", async ({ page }) => {
  await page.evaluate(async () => {
    const interactionPath = "/src/lib/viewer-interaction.ts";
    const threePath = "/node_modules/three/build/three.module.js";
    const { ViewerInteraction } = await import(interactionPath);
    const THREE = await import(threePath);
    const host = document.createElement("div");
    host.id = "measure-probe";
    host.style.cssText = "position:fixed;left:90px;top:100px;width:700px;height:460px;background:#20262b;z-index:100";
    const canvas = document.createElement("canvas"); host.append(canvas); document.querySelector(".qn-theme")!.append(host);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setSize(700, 460);
    const camera = new THREE.OrthographicCamera(-5, 5, 3.286, -3.286, .1, 100);
    camera.position.set(8, 6, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x20262b);
    const grid = new THREE.GridHelper(10, 10, 0x596872, 0x354149); scene.add(grid);
    let measures: any[] = [];
    let renderQueued = false;
    const model = { raycastWithSnapping: async () => [{ point: new THREE.Vector3(0, 0, 0) }] };
    const interaction = new ViewerInteraction(host, canvas, scene, camera, {
      activeModel: () => model, onMultiSelection: () => {}, onMeasurements: (m: any[]) => measures = m,
      onInvalidate: () => { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); } },
    });
    function render() { interaction.updateOverlay(); renderer.render(scene, camera); }
    canvas.addEventListener("click", e => interaction.handleClick(e));
    canvas.addEventListener("pointermove", e => interaction.handlePointerMove(e));
    interaction.setTool("measure"); render();
    const axisPixel = (axis: string, sign = 1) => {
      const direction = axis === "X" ? new THREE.Vector3(1, 0, 0) : axis === "Y" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      const p = direction.multiplyScalar(interaction.axisLength * .75 * sign).project(camera);
      return { x: 90 + (p.x + 1) * 350, y: 100 + (1 - p.y) * 230 };
    };
    (window as any).__measure = { interaction, camera, render, axisPixel, measures: () => measures,
      useDirectionPoint: () => { model.raycastWithSnapping = async () => [{ point: new THREE.Vector3(4, 2, 3) }]; },
      labelError: () => {
        let maxError = 0;
        for (let i = 0; i < 24; i++) {
          camera.position.set(8 * Math.cos(i * .07), 6, 10 * Math.sin(i * .07) + 3);
          camera.lookAt(0, 0, 0);
          const reference = camera.clone(); reference.updateMatrixWorld();
          const m = measures[0];
          const mid = new THREE.Vector3().addVectors(new THREE.Vector3(m.start.x, m.start.y, m.start.z), new THREE.Vector3(m.end.x, m.end.y, m.end.z)).multiplyScalar(.5).project(reference);
          interaction.updateOverlay();
          const transform = host.querySelector<HTMLElement>(".viewer-measurement-label")!.style.transform;
          const xy = transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!;
          maxError = Math.max(maxError, Math.abs(Number(xy[1]) - (mid.x + 1) * 350), Math.abs(Number(xy[2]) - (1 - mid.y) * 230));
        }
        render(); return maxError;
      },
      dispose: () => { interaction.dispose(); renderer.dispose(); grid.geometry.dispose(); [grid.material].flat().forEach((m: any) => m.dispose()); host.remove(); },
    };
  });
  const host = page.locator("#measure-probe");
  await host.locator("canvas").click({ position: { x: 350, y: 230 } });
  await page.keyboard.type("2500");
  const dock = host.locator(".viewer-measurement-entry");
  await expect(dock).toBeVisible();
  await page.keyboard.press("Enter");
  const input = host.getByRole("textbox", { name: "Measurement distance" });
  const unit = host.getByRole("combobox", { name: "Measurement unit" });
  await unit.selectOption("m"); await expect(input).toHaveValue("2.5");
  await unit.selectOption("mm"); await expect(input).toHaveValue("2500");
  await expect(unit).toBeEnabled();
  const before = await dock.boundingBox();
  await page.mouse.move(220, 160); await page.mouse.move(680, 390);
  expect(await dock.boundingBox()).toEqual(before);
  expect(before!.width).toBeLessThan(220);
  expect(before!.x).toBeGreaterThan(90 + 350);
  expect(before!.x).toBeLessThan(90 + 400);
  expect(before!.y + before!.height).toBeLessThan(100 + 230);
  expect(before!.y + before!.height).toBeGreaterThan(100 + 180);
  const unitWidth = await unit.evaluate(e => e.clientWidth);
  expect(unitWidth).toBeGreaterThanOrEqual(50);
  await expect(host.locator(".viewer-measurement-axis-label:not([hidden])")).toHaveCount(3);
  await mkdir("../benchmarks/results/semantic-measure-ui", { recursive: true });
  await host.screenshot({ path: "../benchmarks/results/semantic-measure-ui/measure-dock.png" });
  const point = await page.evaluate(() => (window as any).__measure.axisPixel("Z", -1));
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => (window as any).__measure.measures().length)).toBe(1);
  const result = await page.evaluate(() => ({ measured: (window as any).__measure.measures()[0], error: (window as any).__measure.labelError() }));
  expect(result.measured.distance).toBeCloseTo(2.5, 8);
  expect(result.measured.end).toEqual({ x: 0, y: -2.5, z: 0 });
  expect(result.error).toBeLessThan(.01);
  await expect(dock).toBeHidden();
  await host.locator("canvas").click({ position: { x: 350, y: 230 } });
  await page.keyboard.type("1000"); await page.keyboard.press("Enter");
  await page.evaluate(() => (window as any).__measure.useDirectionPoint());
  await host.locator("canvas").click({ position: { x: 30, y: 30 } });
  await expect.poll(() => page.evaluate(() => (window as any).__measure.measures().length)).toBe(2);
  const directed = await page.evaluate(() => (window as any).__measure.measures()[1]);
  expect(directed.distance).toBeCloseTo(1, 8);
  expect(directed.end.x).toBeCloseTo(4 / Math.sqrt(29), 8);
  expect(directed.end.y).toBeCloseTo(2 / Math.sqrt(29), 8);
  expect(directed.end.z).toBeCloseTo(3 / Math.sqrt(29), 8);
  await page.evaluate(() => (window as any).__measure.dispose());
});

test("semantic status shows stalled work, retries repeatedly, then completes", async ({ page }) => {
  await page.evaluate(async () => {
    const apiPath = "/src/lib/api.ts";
    const { api } = await import(apiPath);
    const hash = "a".repeat(64);
    let retries = 0;
    const runtime = () => ({ hasActiveModel: true, activeModelHash: hash, hotIndexStatus: "ready",
      coldIndexStatus: retries >= 2 ? "ready" : "indexing",
      semanticProgress: { modelHash: hash, attemptId: `attempt-${retries}`, phase: retries >= 2 ? "ready" : "cold", completed: retries >= 2 ? 500 : 128, total: 500,
        category: "IfcBeam", status: retries >= 2 ? "ready" : "running", idleSeconds: 125, stallAfterSeconds: 120, stalled: retries < 2, error: null } });
    api.activateModel = async () => ({ contentHashSha256: hash, loadedAt: "activation" });
    api.runtime = async () => runtime();
    api.retrySemantic = async (model: any, attempt: string) => {
      if (model.loadedAt !== "activation" || attempt !== `attempt-${retries}`) throw Error("wrong generation");
      retries++;
    };
    (window as any).__semanticRetries = () => retries;
    const viewer = (window as any).__viewer;
    const sequence = ++viewer.loader.loadSequence;
    viewer.callbacks.onProgress({ loadSequence: sequence, modelHash: hash, stage: "ready" });
    void viewer.bridge.watchModel(new File(["IFC"], "semantic.ifc"), hash, sequence, { contentHashSha256: hash, loadedAt: "activation" });
  });
  const status = page.locator(".semantic-status");
  await expect(status).toContainText("128 / 500");
  await expect(status).toContainText("IfcBeam");
  await expect(status).toContainText("125s");
  await expect(status.getByRole("progressbar")).toHaveAttribute("value", "128");
  await mkdir("../benchmarks/results/semantic-measure-ui", { recursive: true });
  await page.screenshot({ path: "../benchmarks/results/semantic-measure-ui/semantic-stalled.png" });
  const retry = status.getByRole("button", { name: "Thử lại" });
  await retry.click();
  await expect.poll(() => page.evaluate(() => (window as any).__semanticRetries())).toBe(1);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(status).toContainText("sẵn sàng");
  await expect(retry).toHaveCount(0);
});

test("Retry after a transport failure resumes monitoring without restarting healthy work", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const bridgePath = "/src/lib/viewer-bridge.ts", apiPath = "/src/lib/api.ts";
    const { ViewerBridge } = await import(bridgePath); const { api } = await import(apiPath);
    let reads = 0, restarts = 0; const stages: string[] = [];
    api.activateModel = async () => ({ contentHashSha256: "A", loadedAt: "a" });
    api.runtime = async () => {
      if (++reads === 1) throw new TypeError("Failed to fetch");
      return { hasActiveModel: true, activeModelHash: "A", hotIndexStatus: "ready", coldIndexStatus: "ready",
        semanticProgress: { attemptId: "first", status: "ready", stalled: false } };
    };
    api.retrySemantic = async () => { restarts++; };
    api.cancelModelLoad = async () => {};
    const bridge = new ViewerBridge({ onProgress: (p: any) => stages.push(p.stage) });
    await bridge.watchModel(new File(["IFC"], "a.ifc"), "A", 1, { contentHashSha256: "A", loadedAt: "a" });
    await bridge.retrySemantic();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await bridge.cancelModelRequests();
    return { stages, restarts };
  });
  expect(result.stages).toContain("error");
  expect(result.stages.at(-1)).toBe("ready");
  expect(result.restarts).toBe(0);
});
