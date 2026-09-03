import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).viewer = event.detail; });
  });
  await page.goto("/?viewerDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).viewer))).toBe(true);
}

test("panels animate without repeated WebGL resizing and the toolbox follows Browser", async ({ page }, info) => {
  await ready(page);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const motion = await page.evaluate(async () => {
    const v = (window as any).viewer;
    const original = v.renderer.setSize.bind(v.renderer); let resizes = 0;
    v.renderer.setSize = (...args: any[]) => { resizes++; return original(...args); };
    (document.querySelector(".workspace-browser-toggle") as HTMLButtonElement).click();
    const frames: any[] = [];
    const started = performance.now();
    while (performance.now() - started < 450) {
      await new Promise(requestAnimationFrame);
      const panel = document.querySelector(".project-browser")!;
      const tools = document.querySelector(".viewer-toolbar")!;
      frames.push({ t: performance.now() - started, x: panel.getBoundingClientRect().x,
        right: panel.getBoundingClientRect().right, tools: tools.getBoundingClientRect().left,
        durations: panel.getAnimations().map(a => a.effect?.getTiming().duration) });
    }
    v.renderer.setSize = original;
    return { frames, resizes };
  });
  expect(motion.frames.some(f => f.durations.includes(340))).toBe(true);
  expect(new Set(motion.frames.map(f => Math.round(f.x))).size).toBeGreaterThan(3);
  expect(motion.resizes).toBeLessThanOrEqual(2);
  const last = motion.frames.at(-1)!;
  expect(last.tools - last.right).toBeCloseTo(12, 0);
  await page.getByRole("button", { name: "Mở/đóng bảng thuộc tính", exact: true }).click();
  await expect(page.locator(".properties-panel")).toBeVisible();
  await page.getByRole("button", { name: "Close Properties", exact: true }).click();
  await expect(page.locator(".properties-panel")).toHaveCount(0);
  // Rapid reversal must retain one usable panel, then fully remove it.
  await page.locator(".workspace-browser-toggle").evaluate(async (button: HTMLButtonElement) => {
    button.click(); await new Promise(r => setTimeout(r, 70)); button.click();
  });
  await expect(page.locator(".project-browser")).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 640, height: 700 });
  await expect.poll(() => page.evaluate(() => {
    const b = document.querySelector(".project-browser")!.getBoundingClientRect();
    return document.querySelector(".viewer-toolbar")!.getBoundingClientRect().left - b.right;
  })).toBeCloseTo(12, 0);
  await page.getByRole("button", { name: "Close Project Browser", exact: true }).click();
  await expect(page.locator(".project-browser")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".workspace-browser-toggle").click();
  expect(await page.locator(".viewer-toolbar").evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
  expect(errors).toEqual([]);
  await info.attach("panel-motion", { body: JSON.stringify(motion, null, 2), contentType: "application/json" });
});

test("rotation preference survives reload and scales mouse drag and ViewCube rotation", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Cài đặt hiển thị", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Tốc độ xoay", exact: true });
  await slider.fill("0.5");
  await expect.poll(() => page.evaluate(() => (window as any).viewer.view.rotationSpeed)).toBe(0.5);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).viewer?.view.rotationSpeed)).toBe(0.5);
  await page.getByRole("button", { name: "Cài đặt hiển thị", exact: true }).click();
  await expect(slider).toHaveValue("0.5");
  await page.getByRole("button", { name: "Cài đặt hiển thị", exact: true }).click();
  const deltas: number[] = [];
  for (const speed of [0.5, 2]) {
    await page.evaluate(speed => {
      const v = (window as any).viewer, view = v.view;
      view.controls.enableDamping = false;
      (window as any).cameraStart ??= view.captureState();
      view.restoreState((window as any).cameraStart); v.setRotationSpeed(speed);
    }, speed);
    const rect = (await page.locator(".viewer-mount canvas").boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2, { steps: 6 }); await page.mouse.up();
    deltas.push(await page.evaluate(() => {
      const a = (window as any).cameraStart, b = (window as any).viewer.view.captureState();
      const yaw = (s: any) => Math.atan2(s.position.x - s.target.x, s.position.z - s.target.z);
      return Math.abs(yaw(b) - yaw(a));
    }));
  }
  expect(deltas[0]).toBeGreaterThan(0.01); expect(deltas[1] / deltas[0]).toBeCloseTo(4, 2);
  const cube = await page.evaluate(() => {
    const root = window as any, view = root.viewer.view;
    return [0.5, 2].map(speed => {
      view.restoreState(root.cameraStart); view.setRotationSpeed(speed); view.orbit(0.1, 0);
      const b = view.captureState(), a = root.cameraStart;
      return Math.abs(Math.atan2(b.position.x-b.target.x,b.position.z-b.target.z) - Math.atan2(a.position.x-a.target.x,a.position.z-a.target.z));
    });
  });
  expect(cube[1] / cube[0]).toBeCloseTo(4, 8);
});

test("clicking IFC sets the item pivot, PAN restores model pivot, and stale picks cannot move a restored view", async ({ page }, info) => {
  const path = process.env.IFC_E2E_MODEL_B; test.skip(!path); test.setTimeout(90000);
  await ready(page);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.locator('input[type="file"]').setInputFiles(path!);
  const orbit = page.getByRole("button", { name: "Chọn cấu kiện làm tâm xoay", exact: true });
  await expect(orbit).toBeEnabled({ timeout: 60000 });
  await expect(page.locator(".model-load-dialog")).toHaveCount(0);
  await page.evaluate(async () => { await (window as any).viewer.view.settled(); });
  const pan = page.getByRole("button", { name: "PAN - xoay và dịch khung nhìn", exact: true });
  expect(await page.locator(".viewer-toolbar__button").nth(1).getAttribute("aria-label")).toBe("Chọn cấu kiện làm tâm xoay");
  await orbit.click();
  const picked = await page.evaluate(async () => {
    const THREE = await import(/* @vite-ignore */ "/node_modules/.vite/deps/three.js");
    const v = (window as any).viewer, model = v.model, canvas = v.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const ids = await model.getItemsIdsWithGeometry();
    for (const id of ids.slice(0, 40)) {
      const bounds = await model.getMergedBox([id]); const p = bounds.getCenter(v.camera.position.clone()).project(v.camera);
      const x = rect.x + (p.x + 1) * rect.width / 2, y = rect.y + (1-p.y) * rect.height / 2;
      if (document.elementFromPoint(x, y) !== canvas) continue;
      const hit = await model.raycast({ camera: v.camera, mouse: new THREE.Vector2(x, y), dom: canvas });
      if (!hit) continue;
      const hitBounds = await model.getMergedBox([hit.localId]);
      return { x, y, id: hit.localId, center: { ...hitBounds.getCenter(v.camera.position.clone()) }, before: v.captureViewState().camera };
    }
    throw new Error("No visible IFC geometry to click");
  });
  await page.mouse.click(picked.x, picked.y);
  await expect.poll(() => page.evaluate(() => (window as any).viewer.captureViewState().selection[0]?.localId)).toBe(picked.id);
  await expect.poll(() => page.evaluate(() => (window as any).viewer.hasSelectionOrbit)).toBe(true);
  await page.evaluate(async () => { await (window as any).viewer.view.settled(); });
  const selected = await page.evaluate(() => (window as any).viewer.captureViewState().camera);
  expect(selected.target).toEqual(picked.center);
  expect(selected.effectiveHeight).toBeCloseTo(picked.before.effectiveHeight, 8);
  const viewport = (await page.locator(".viewer-mount canvas").boundingBox())!;
  await page.mouse.move(viewport.x + viewport.width * 0.3, viewport.y + viewport.height * 0.3);
  await page.mouse.wheel(0, -180);
  await expect.poll(() => page.evaluate(() => (window as any).viewer.captureViewState().camera.effectiveHeight)).toBeLessThan(selected.effectiveHeight);
  expect(await page.evaluate(() => (window as any).viewer.captureViewState().camera.target)).toEqual(picked.center);
  await page.evaluate(() => (window as any).viewer.orbitView(0.15, 0.08));
  expect(await page.evaluate(() => (window as any).viewer.captureViewState().camera.target)).toEqual(picked.center);
  await pan.click(); await page.evaluate(async () => { await (window as any).viewer.view.settled(); });
  const modelPivot = await page.evaluate(() => { const v = (window as any).viewer; return { actual: v.captureViewState().camera.target, expected: {...v.model.box.getCenter(v.camera.position.clone())} }; });
  expect(modelPivot.actual).toEqual(modelPivot.expected);
  await orbit.click(); await page.evaluate(async () => { await (window as any).viewer.view.settled(); });
  const restored = await page.evaluate(async () => {
    const v = (window as any).viewer;
    const state = v.captureViewState(); state.camera.target.x += 2; state.camera.position.x += 2;
    await v.applyViewState(state); await v.view.settled();
    return { expected: state.camera, actual: v.captureViewState().camera };
  });
  expect(restored.actual).toEqual(restored.expected);
  await page.evaluate(() => {
    const root = window as any, v = root.viewer, model = v.model;
    root.originalBoxes = model.getMergedBox.bind(model);
    model.getMergedBox = async (ids: number[]) => { const bounds = await root.originalBoxes(ids); await new Promise(resolve => { root.releasePivot = resolve; }); return bounds; };
    root.pendingPick = v.selectItems([v.captureViewState().selection[0].localId]);
  });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).releasePivot))).toBe(true);
  await pan.click();
  await page.evaluate(async () => { const root = window as any; root.releasePivot(); await root.pendingPick; root.viewer.model.getMergedBox = root.originalBoxes; await root.viewer.view.settled(); });
  const race = await page.evaluate(() => { const v = (window as any).viewer; return { actual: v.captureViewState().camera.target, expected: {...v.model.box.getCenter(v.camera.position.clone())} }; });
  expect(race.actual).toEqual(race.expected);
  // Fit is a newer navigation intent even if the orbit tool stays selected.
  await page.evaluate(() => {
    const root = window as any, v = root.viewer;
    root.releasePivot = null;
    v.model.getMergedBox = async (ids: number[]) => { const bounds = await root.originalBoxes(ids); await new Promise(resolve => { root.releasePivot = resolve; }); return bounds; };
    v.setTool("selectOrbit");
  });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).releasePivot))).toBe(true);
  await page.evaluate(async () => {
    const root = window as any, v = root.viewer;
    v.fit({animate:false}); root.fitState = v.captureViewState().camera; root.releasePivot();
    v.model.getMergedBox = root.originalBoxes;
  });
  await page.waitForTimeout(400);
  const fitRace = await page.evaluate(() => ({actual:(window as any).viewer.captureViewState().camera,expected:(window as any).fitState}));
  expect(fitRace.actual.target).toEqual(fitRace.expected.target);
  expect(fitRace.actual.effectiveHeight).toBeCloseTo(fitRace.expected.effectiveHeight, 8);
  for (const axis of ["x", "y", "z"]) expect(fitRace.actual.position[axis]).toBeCloseTo(fitRace.expected.position[axis], 8);
  await pan.click(); await orbit.click();
  await page.getByRole("button", {name:"Project Browser",exact:true}).click();
  await page.waitForTimeout(450);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("selected-orbit.png") });
  await info.attach("orbit-pivot", { body: JSON.stringify({ picked, selected, modelPivot, restored, race }, null, 2), contentType: "application/json" });
});
