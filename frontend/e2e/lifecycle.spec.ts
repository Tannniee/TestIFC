import { expect, test } from "@playwright/test";

test("twenty viewer lifecycles leave one canvas and one active viewer", async ({ page }) => {
  await page.route("**/health", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ok: true, appVersion: "e2e" }),
  }));
  await page.goto("/");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const baseline = await cdp.send("Runtime.getHeapUsage");

  for (let cycle = 0; cycle < 20; cycle += 1) {
    await page.evaluate(async () => {
      if (!window.__ifcViewerLifecycle) throw new Error("Lifecycle probe is unavailable");
      await window.__ifcViewerLifecycle.remount();
    });
    await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
  }

  const snapshot = await page.evaluate(() => window.__ifcViewerLifecycle?.snapshot());
  expect(snapshot).toBeDefined();
  expect(snapshot?.canvasCount).toBe(1);
  expect(snapshot?.active).toBe(1);
  expect((snapshot?.created ?? 0) - (snapshot?.disposed ?? 0)).toBe(1);

  await cdp.send("HeapProfiler.collectGarbage");
  const final = await cdp.send("Runtime.getHeapUsage");
  expect(final.usedSize).toBeLessThanOrEqual(baseline.usedSize + 16 * 1024 * 1024);
});
