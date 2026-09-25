import { expect, test } from "@playwright/test";

const hash = process.env.IFC_E2E_LARGE_HASH;
const bytes = Number(process.env.IFC_E2E_LARGE_BYTES || 0);

test("cached large IFC opens through Engine V2 and closes cleanly", async ({ page }) => {
  test.skip(!hash || bytes <= 1024 ** 3, "Set a cached large IFC hash and byte count");
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).__viewer = event.detail; });
    window.addEventListener("ifc-fragment-metrics", (event: any) => { (window as any).__metrics = event.detail; });
  });
  await page.goto("/?viewerDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewer))).toBe(true);
  const result = await page.evaluate(async ({ hash, bytes }) => {
    const viewer = (window as any).__viewer;
    const started = performance.now();
    await viewer.load({ name: "large.ifc", size: bytes, modelHash: hash, origin: "desktop" });
    const opened = { engine: viewer.model?.engine, hash: viewer.modelHash, artifact: viewer.artifactId,
      loadMilliseconds: performance.now() - started, metrics: (window as any).__metrics };
    await viewer.closeModel();
    return { ...opened, closed: viewer.model === null };
  }, { hash, bytes });
  expect(result).toMatchObject({ engine: "engine-v2", hash, closed: true });
  expect(result.artifact).toContain("engine-v2:");
  expect(pageErrors).toEqual([]);
  console.log(JSON.stringify({ loadMilliseconds: result.loadMilliseconds, metrics: result.metrics }));
});

test("large browser source uses backend hash without FileReader", async ({ page }) => {
  test.skip(!hash || bytes <= 1024 ** 3, "Set a cached large IFC hash and byte count");
  test.setTimeout(180_000);
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).__viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewer))).toBe(true);
  const result = await page.evaluate(async ({ hash, bytes }) => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const originalUpload = api.uploadModel;
    const originalReader = window.FileReader;
    let uploads = 0;
    api.uploadModel = async () => {
      uploads++;
      return { modelHash: hash, sizeBytes: bytes, originalFilename: "large.ifc" };
    };
    window.FileReader = class { constructor() { throw new Error("large IFC was read into browser memory"); } } as any;
    try {
      const viewer = (window as any).__viewer;
      await viewer.load({ name: "large.ifc", size: bytes, file: new File(["fixture"], "large.ifc"), origin: "browser" });
      const opened = { engine: viewer.model?.engine, hash: viewer.modelHash, uploads };
      await viewer.closeModel();
      return opened;
    } finally {
      api.uploadModel = originalUpload;
      window.FileReader = originalReader;
    }
  }, { hash, bytes });
  expect(result).toEqual({ engine: "engine-v2", hash, uploads: 1 });
});
