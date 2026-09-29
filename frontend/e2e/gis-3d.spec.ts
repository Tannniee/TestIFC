import { expect, test } from "@playwright/test";

test("GIS map renders IFC geometry and synchronizes element selection", async ({ page }) => {
  test.skip(!process.env.IFC_E2E_BIM_FIXTURE, "Set IFC_E2E_BIM_FIXTURE");
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await page.waitForFunction(() => !!(window as any).viewer);
  await page.locator('input[type="file"]').setInputFiles(process.env.IFC_E2E_BIM_FIXTURE!);
  await expect.poll(() => page.evaluate(() => (window as any).viewer?.modelHash),
    { timeout: 60_000 }).toMatch(/^[0-9a-f]{64}$/);
  await page.getByRole("button", { name: "Project Browser" }).click();
  const panel = page.getByRole("complementary", { name: "Project Browser" });
  await panel.getByText("GIS · Manual anchor").click();
  await panel.getByLabel("GIS longitude").fill("105.8");
  await panel.getByLabel("GIS latitude").fill("21");
  await panel.getByLabel("GIS scale").fill("100");
  await panel.getByRole("button", { name: "Save anchor" }).click();
  await panel.getByRole("button", { name: "Xem trên bản đồ" }).click();
  const preview = panel.getByLabel("GIS anchor map preview");
  await expect(preview.locator('.gis-map-canvas[data-gis3d="ready"]')).toHaveCount(1, { timeout: 30_000 });
  if (process.env.IFC_E2E_REQUIRE_MAPTILER) await expect(preview.locator(".gis-map-caption > span"))
    .toHaveText("MapTiler streets · cần Internet");
  await preview.getByRole("button", { name: "Offline view" }).click();
  await expect(preview).toContainText("Mô hình IFC 3D · 1 phần hình học · 12 tam giác");
  await expect(preview).toContainText("Nền trống");
  await expect(preview.locator('.gis-map-canvas[data-gis3d="ready"]')).toHaveCount(1, { timeout: 15_000 });
  if (process.env.IFC_GIS_SCREENSHOT) await preview.screenshot({ path: process.env.IFC_GIS_SCREENSHOT });
  const canvas = preview.locator(".maplibregl-canvas");
  const size = await canvas.boundingBox();
  expect(size).not.toBeNull();
  await canvas.click({ position: { x: size!.width / 2, y: size!.height * 0.3 } });
  await expect.poll(() => page.evaluate(() => (window as any).viewer.captureViewState().selection[0]?.localId)).toBe(5);
  await expect.poll(() => page.evaluate(() => (window as any).viewer.captureViewState().selection[0]?.globalId))
    .toBe("3pQnedmDr2W9TjRvz8roX9");
  await expect(panel.getByLabel("GIS longitude")).toHaveValue("105.8");
  expect(errors).toEqual([]);
});

test("IFC EPSG georeference positions the model without a manual anchor", async ({ page }) => {
  test.skip(!process.env.IFC_E2E_GEOREF_FIXTURE, "Set IFC_E2E_GEOREF_FIXTURE");
  test.setTimeout(90_000);
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await page.waitForFunction(() => !!(window as any).viewer);
  await page.locator('input[type="file"]').setInputFiles(process.env.IFC_E2E_GEOREF_FIXTURE!);
  await expect.poll(() => page.evaluate(() => (window as any).viewer?.modelHash),
    { timeout: 60_000 }).toMatch(/^[0-9a-f]{64}$/);
  await expect.poll(async () => page.evaluate(async () => {
    const hash = (window as any).viewer.modelHash;
    const response = await fetch(`/model/georeference?modelHash=${hash}`);
    return response.ok ? (await response.json()).wgs84?.controlPoints?.origin?.longitude : null;
  }), { timeout: 60_000 }).toBeGreaterThan(8);
  let preparingReplies = 0;
  await page.route("**/model/georeference?**", async route => {
    if (preparingReplies++ < 2) await route.fulfill({ status: 409, contentType: "application/json",
      body: JSON.stringify({ error: "index_preparing" }) });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Project Browser" }).click();
  const panel = page.getByRole("complementary", { name: "Project Browser" });
  await panel.getByText("GIS · Manual anchor").click();
  await expect(panel.getByLabel("GIS longitude")).toBeEnabled();
  await expect(panel).toContainText("IFC CRS: EPSG:25832", { timeout: 10_000 });
  await panel.getByRole("button", { name: "Xem trên bản đồ" }).click();
  const preview = panel.getByLabel("GIS anchor map preview");
  await expect(preview).toContainText("IFC CRS EPSG:25832");
  await expect(preview.locator(".maplibregl-marker")).toHaveCount(1);
  await preview.getByRole("button", { name: "Offline view" }).click();
  await expect(preview.locator('.gis-map-canvas[data-gis3d="ready"]')).toHaveCount(1, { timeout: 15_000 });
  if (process.env.IFC_GEO_SCREENSHOT) await preview.screenshot({ path: process.env.IFC_GEO_SCREENSHOT });
});
