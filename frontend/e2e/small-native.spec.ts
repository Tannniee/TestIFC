import { expect, test } from "@playwright/test";

const modelPath = process.env.IFC_E2E_MODEL_PATH;
const unsupportedPath = process.env.IFC_E2E_UNSUPPORTED_MODEL_PATH;

test("small browser IFC opens and closes through Engine V2", async ({ page }) => {
  test.skip(!modelPath, "Set IFC_E2E_MODEL_PATH to an Engine V2 supported IFC");
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).__viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewer))).toBe(true);
  await page.locator('input[type="file"]').setInputFiles(modelPath!);
  await expect.poll(() => page.evaluate(() => (window as any).__viewer?.model?.engine), { timeout: 90_000 })
    .toBe("engine-v2");
  const result = await page.evaluate(async () => {
    const viewer = (window as any).__viewer;
    const opened = { hash: viewer.modelHash, artifact: viewer.artifactId, hasLegacy: "fragments" in viewer.loader };
    await viewer.closeModel();
    return { ...opened, closed: viewer.model === null };
  });
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/i);
  expect(result.artifact).toContain("engine-v2:");
  expect(result).toMatchObject({ hasLegacy: false, closed: true });
  expect(pageErrors).toEqual([]);
});

test("unsupported native geometry reports an error and keeps the active model", async ({ page }) => {
  test.skip(!modelPath || !unsupportedPath, "Set supported and unsupported IFC fixture paths");
  test.setTimeout(120_000);
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).__viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewer))).toBe(true);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(modelPath!);
  await expect.poll(() => page.evaluate(() => (window as any).__viewer?.model?.engine), { timeout: 90_000 })
    .toBe("engine-v2");
  const original = await page.evaluate(() => (window as any).__viewer.modelHash);
  await input.setInputFiles(unsupportedPath!);
  await expect(page.getByRole("alert")).toContainText("Engine V2 chưa hỗ trợ hình học", { timeout: 90_000 });
  expect(await page.evaluate(() => ({ hash: (window as any).__viewer.modelHash,
    engine: (window as any).__viewer.model?.engine }))).toEqual({ hash: original, engine: "engine-v2" });
});
