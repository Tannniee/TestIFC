import { expect, test } from "@playwright/test";

const fixture = process.env.IFC_E2E_BIM_FIXTURE;

test("Properties displays indexed IFC Psets, Qto, and material for a selected element", async ({ page }) => {
  test.skip(!fixture, "Set IFC_E2E_BIM_FIXTURE to a BIM IFC fixture");
  test.setTimeout(90_000);
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await page.locator('input[type="file"]').setInputFiles(fixture!);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).viewer?.model)), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/model/runtime")).json()).coldIndexStatus),
    { timeout: 60_000 }).toBe("ready");
  const selected = await page.evaluate(async () => {
    const viewer = (window as any).viewer;
    const [expressId] = await viewer.model.getItemsIdsWithGeometry();
    await viewer.selectItems([expressId]);
    return { expressId, modelHash: viewer.modelHash };
  });
  const response = await page.evaluate(async ({ expressId, modelHash }) => {
    const request = await fetch(`/element/by-express-id/${expressId}/bim?modelHash=${modelHash}`);
    return { status: request.status, body: await request.json() };
  }, selected);
  expect(response.status).toBe(200);
  expect(response.body.coldStatus).toBe("ready");
  expect(response.body.element.properties).toHaveProperty("Pset_Phase3Benchmark");
  expect(response.body.element.quantities).toHaveProperty("Qto_BeamBaseQuantities");

  const panel = page.getByRole("complementary", { name: "Properties" });
  await panel.getByRole("button", { name: "Psets / Quantities" }).click();
  await expect(panel).toContainText("Pset_Phase3Benchmark");
  await expect(panel).toContainText("Qto_BeamBaseQuantities");
  await panel.getByRole("button", { name: "IFC Relations" }).click();
  await expect(panel).toContainText("Steel");
  await expect(panel).toContainText("Spatial 4: Level 1");
});
