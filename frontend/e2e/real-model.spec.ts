import { expect, test } from "@playwright/test";

const modelPath = process.env.IFC_E2E_MODEL_PATH;

test("real IFC reopens from fragment cache without duplicating the viewer", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  test.skip(!modelPath, "Set IFC_E2E_MODEL_PATH to run the private real-model gate");
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as typeof window & { __ifcMetrics?: unknown[] };
    state.__ifcMetrics = [];
    window.addEventListener("ifc-fragment-metrics", (event) => {
      state.__ifcMetrics?.push((event as CustomEvent).detail);
    });
  });

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(modelPath!);
  await expect.poll(
    () => page.evaluate(() => ((window as typeof window & { __ifcMetrics?: unknown[] }).__ifcMetrics?.length ?? 0)),
    { timeout: 10 * 60_000 },
  ).toBe(1);

  await page.locator(".document-tabs .tab-close").click();
  await expect(page.locator(".document-tabs [role=tab]")).toHaveCount(0);
  await input.setInputFiles(modelPath!);
  await expect.poll(
    () => page.evaluate(() => ((window as typeof window & { __ifcMetrics?: unknown[] }).__ifcMetrics?.length ?? 0)),
    { timeout: 10 * 60_000 },
  ).toBe(2);

  const metrics = await page.evaluate(
    () => (window as typeof window & { __ifcMetrics?: Array<{ modelHash: string; cacheHit: boolean }> }).__ifcMetrics,
  );
  await testInfo.attach("fragment-metrics", {
    body: JSON.stringify(metrics, null, 2), contentType: "application/json",
  });
  expect(metrics).toHaveLength(2);
  expect(metrics?.[1].modelHash).toBe(metrics?.[0].modelHash);
  expect(metrics?.[1].cacheHit).toBe(true);
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);

  await expect.poll(() => page.evaluate(async () => (await (await fetch("/model/runtime")).json()).coldIndexStatus), { timeout: 60000 }).toBe("ready");
  const runtime = await page.evaluate(async () => (await fetch("/model/runtime")).json());
  expect(runtime.activeModelHash).toBe(metrics?.[1].modelHash);
  expect(runtime.hotIndexStatus).toBe("ready");
  expect(runtime.coldIndexStatus).toBe("ready");
});
