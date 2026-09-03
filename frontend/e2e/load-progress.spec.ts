import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.route("**/health", (route) => route.fulfill({ json: { ok: true, appVersion: "1.0.3" } }));
  await page.route("**/selection", (route) => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).__viewer = event.detail; }));
  await page.goto("/?viewerDebug=1");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
});

test("two progress bars show real phases, reset on reopen, and cancel via button or Escape", async ({ page }) => {
  await page.evaluate(async () => {
    const { LoadCancelledError } = await import(/* @vite-ignore */ "/src/lib/viewer-contracts.ts");
    const viewer = (window as any).__viewer;
    let rejectLoad: ((error: Error) => void) | null = null;
    const cancel = viewer.cancelLoad.bind(viewer);
    viewer.cancelLoad = () => { rejectLoad?.(new LoadCancelledError()); rejectLoad = null; return cancel(); };
    viewer.load = function (file: File) {
      const sequence = ++this.loader.loadSequence;
      this.loader.publishProgress(sequence, { modelHash: "a", stage: "converting", progress: .675, phase: "attributes", category: "IfcBeam", entitiesProcessed: 1248, detail: file.name });
      (window as any).setLoadPhase = (progress: object) => this.loader.publishProgress(sequence, { modelHash: "a", detail: file.name, ...progress });
      return new Promise((_,reject) => { rejectLoad = reject; });
    };
  });
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "STRUCTURE_A.ifc", mimeType: "application/octet-stream", buffer: Buffer.from("IFC") });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bars = dialog.getByRole("progressbar");
  await expect(bars).toHaveCount(2);
  await expect(bars.nth(0)).toHaveAttribute("value", "53.875");
  await expect(dialog).toContainText("Đang đọc thuộc tính IFC");
  await expect(dialog).toContainText("IfcBeam");
  await mkdir("../benchmarks/results/load-progress-ui", { recursive: true });
  await page.screenshot({ path: "../benchmarks/results/load-progress-ui/dialog-light.png" });
  await dialog.screenshot({ path: "../benchmarks/results/load-progress-ui/dialog-preview.png" });
  await page.evaluate(() => document.querySelector(".qn-theme")!.setAttribute("data-mode", "dark"));
  await page.screenshot({ path: "../benchmarks/results/load-progress-ui/dialog-dark.png" });
  await page.setViewportSize({ width: 420, height: 620 });
  await expect(dialog).toBeInViewport();
  await page.screenshot({ path: "../benchmarks/results/load-progress-ui/dialog-narrow.png" });
  await page.evaluate(() => (window as any).setLoadPhase({ stage: "finalizing" }));
  await expect(bars.nth(1)).not.toHaveAttribute("value");
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".viewer-empty-state")).toContainText("Đã hủy");
  await page.evaluate(() => (window as any).setLoadPhase({ stage: "ready" }));
  await expect(page.locator(".viewer-empty-state")).toContainText("Đã hủy");
  await input.setInputFiles({ name: "STRUCTURE_B.ifc", mimeType: "application/octet-stream", buffer: Buffer.from("IFC") });
  await expect(dialog).toContainText("STRUCTURE_B.ifc");
  await expect(bars.nth(0)).toHaveAttribute("value", "53.875");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("XHR upload is storage-only and AbortSignal rejects before and during transport", async ({ page }) => {
  let url = "";
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/load-model?*", async (route) => {
    url = route.request().url();
    await held;
    await route.fulfill({ json: { modelHash: "old" } }).catch(() => {});
  });
  await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(path);
    const controller = new AbortController();
    (window as any).abortUpload = () => controller.abort();
    (window as any).uploadResult = api.uploadModel(new File(["IFC"], "a.ifc"), () => {}, controller.signal).then(() => "success", (error: Error) => error.name);
  });
  await expect.poll(() => url).toContain("storeOnly=true");
  await page.evaluate(() => (window as any).abortUpload());
  expect(await page.evaluate(() => (window as any).uploadResult)).toBe("AbortError");
  release();
  const before = await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(path);
    const controller = new AbortController(); controller.abort();
    return api.uploadModel(new File(["IFC"], "a.ifc"), () => {}, controller.signal).then(() => "success", (error: Error) => error.name);
  });
  expect(before).toBe("AbortError");
});

test("cancel waits for stage reply and rolls back that exact ticket without activating it", async ({ page }) => {
  const calls = await page.evaluate(async () => {
    const bridgePath = "/src/lib/model-staging.ts";
    const apiPath = "/src/lib/api.ts";
    const { ModelStage } = await import(bridgePath);
    const { api } = await import(apiPath);
    const saved = { ...api };
    const calls: string[] = [];
    let finish!: (value: object) => void;
    let ticket = "";
    api.stageModel = async (id: string, hash: string) => {
      ticket = id;
      calls.push(`stage:${hash}`);
      return new Promise((resolve) => { finish = resolve; });
    };
    api.stageAction = async (id: string, action: string) => { calls.push(`${action}:${id === ticket}`); };
    api.runtime = async () => ({ hasActiveModel: true, activeModelHash: "B", hotIndexStatus: "ready", coldIndexStatus: "ready" });
    const controller = new AbortController();
    try {
      const file = new File(["IFC"], "a.ifc");
      const a = ModelStage.prepare(file, "A", controller.signal, () => {}).catch((e: Error) => e.name);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      controller.abort();
      finish({ stageId: ticket, model: { contentHashSha256: "A", loadedAt: "old" } });
      await a;
      return calls;
    } finally { Object.assign(api, saved); }
  });
  expect(calls).toEqual(["stage:A", "rollback:true"]);
});

test("real IFC conversion cancels and the same file can open again", async ({ page }) => {
  test.setTimeout(180_000);
  const modelPath = process.env.IFC_E2E_MODEL_PATH;
  test.skip(!modelPath, "Set IFC_E2E_MODEL_PATH for the real conversion cancellation gate");
  // Force conversion while keeping the user's source/cache untouched.
  await page.route("**/model/fragments/*", (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 404, json: { error: "fragments_not_cached" } }) : route.continue());
  await page.evaluate(async () => {
    const converter = (window as any).__viewer.loader.converter;
    const convert = converter.convert;
    converter.convert = function (...args: any[]) {
      (window as any).conversionStarted = true;
      return convert.apply(this, args);
    };
    (window as any).loadMetrics = [];
    window.addEventListener("ifc-fragment-metrics", (event) => (window as any).loadMetrics.push((event as CustomEvent).detail));
  });
  const input = page.locator('input[type="file"]');
  const previousHash = await page.evaluate(async () => (await (await fetch("/model/runtime")).json()).activeModelHash);
  await input.setInputFiles(modelPath!);
  await expect.poll(() => page.evaluate(() => (window as any).conversionStarted)).toBe(true);
  await page.getByRole("dialog").getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".viewer-empty-state")).toContainText("Đã hủy");
  expect(await page.evaluate(() => (window as any).loadMetrics.length)).toBe(0);
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/model/runtime")).json()).activeModelHash)).toBe(previousHash);
  await page.unroute("**/model/fragments/*");
  await input.setInputFiles(modelPath!);
  await expect.poll(() => page.evaluate(() => (window as any).loadMetrics.length), { timeout: 120_000 }).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
  await expect(page.locator(".viewer-empty-state")).toHaveCount(0);
});
