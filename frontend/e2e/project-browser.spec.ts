import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const fixture = process.env.IFC_E2E_BIM_FIXTURE;

test("Project Browser switches semantic views and tree actions update model visibility", async ({ page }) => {
  test.skip(!fixture, "Set IFC_E2E_BIM_FIXTURE to a BIM IFC fixture");
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await page.waitForFunction(() => !!(window as any).viewer);
  await page.locator('input[type="file"]').setInputFiles(fixture!);
  await expect.poll(() => page.evaluate(() => (window as any).viewer?.modelHash),
    { timeout: 60_000 }).toMatch(/^[0-9a-f]{64}$/);
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/model/runtime")).json()).coldIndexStatus),
    { timeout: 60_000 }).toBe("ready");
  await page.getByRole("button", { name: "Project Browser" }).click();
  const panel = page.getByRole("complementary", { name: "Project Browser" });
  await panel.getByRole("button", { name: "Model", exact: true }).click();
  await panel.getByLabel("Search tree").fill("Synthetic Beam");
  await expect(panel.getByRole("treeitem", { name: /Synthetic Beam/ })).toBeVisible();
  await panel.getByLabel("Search tree").fill("");
  await panel.getByLabel("View by").selectOption("material");
  await expect(panel).toContainText("Steel (1)");
  await panel.getByRole("button", { name: "Expand Steel" }).click();
  const beam = panel.getByRole("treeitem", { name: /Synthetic Beam/ });
  await expect(beam).toBeVisible();
  await panel.getByLabel("Search tree").fill("Synthetic Beam");
  await expect(beam).toBeVisible();
  await panel.getByLabel("IFC type filter").selectOption("IfcBeam");
  await beam.click({ button: "right" });
  await panel.getByRole("button", { name: "Hide", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const viewer = (window as any).viewer;
    const ids = await viewer.model.getItemsByVisibility(false);
    return ids.includes(5);
  })).toBe(true);
  await panel.getByLabel("Tree scope").selectOption("visible");
  await expect(beam).toHaveCount(0);
  await panel.getByRole("button", { name: "Show all elements" }).click();
  await expect.poll(() => page.evaluate(async () => (await (window as any).viewer.model.getVisible([5]))[0])).toBe(true);
  await panel.getByLabel("Tree scope").selectOption("all");
  await panel.getByLabel("Property kind").selectOption("pset");
  await panel.getByLabel("Set name").fill("Pset_Phase3Benchmark");
  await panel.getByLabel("Property name").fill("Profile");
  await panel.getByLabel("Property value").fill("PL 10x200");
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByRole("status")).toContainText("1 kết quả");
  await expect(beam).toBeVisible();
  await panel.getByLabel("Property kind").selectOption("qto");
  await panel.getByLabel("Set name").fill("Qto_BeamBaseQuantities");
  await panel.getByLabel("Property name").fill("NetVolume");
  await panel.getByLabel("Property operator").selectOption("gte");
  await panel.getByLabel("Property value").fill("0.007");
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByRole("status")).toContainText("1 kết quả");
  await panel.getByRole("button", { name: "Clear", exact: true }).click();
  await panel.getByLabel("Search tree").fill("");
  await panel.getByLabel("IFC type filter").selectOption("");
  for (const view of ["systems", "types", "groups", "classification"] as const) {
    await panel.getByLabel("View by").selectOption(view);
    await expect(panel.getByRole("tree")).toContainText("Unassigned (1)");
  }
  // The GIS entry moved out of the tree into the main Mapbox workspace.
  // Live tiles, map picking and all placement controls are exercised by
  // mapbox-smoke.mjs; keep the tree/anchor boundary covered here.
  const anchor = await page.evaluate(async () => {
    const modelHash = (window as any).viewer.modelHash;
    const response = await fetch("/model/gis-anchor", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelHash, longitude: 105.8, latitude: 21,
        elevationMeters: 12.5, rotationDegrees: 30, scale: 1 }) });
    return response.json();
  });
  expect(anchor).toMatchObject({ status: "manual", source: "manual",
    anchor: { longitude: 105.8, latitude: 21, elevationMeters: 12.5, rotationDegrees: 30, scale: 1 } });
  await expect(panel.getByText("GIS · Manual anchor")).toHaveCount(0);
  await page.getByRole("button", { name: "BIM–GIS Mapbox", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Mapbox BIM–GIS"]');
  await expect(frame.locator("html")).toHaveAttribute("data-model-state", "ready", { timeout: 30000 });
  await expect(frame.locator("html")).toHaveAttribute("data-model-yaw", "30");
  await page.getByRole("button", { name: "Về IFC viewer", exact: true }).click();
  await expect(panel.getByLabel("View by")).toHaveValue("classification");
  await expect(panel.getByRole("tree")).toContainText("Unassigned (1)");
  const deleted = await page.evaluate(async () => {
    const hash = (window as any).viewer.modelHash;
    return (await fetch(`/model/gis-anchor?modelHash=${hash}`, { method: "DELETE" })).json();
  });
  expect(deleted.status).toBe("unavailable");
  expect(pageErrors).toEqual([]);
});

test("Project Browser follows the viewed IFC when documents switch", async ({ page }) => {
  test.skip(!fixture, "Set IFC_E2E_BIM_FIXTURE to a BIM IFC fixture");
  test.setTimeout(90_000);
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await page.locator('input[type="file"]').setInputFiles(fixture!);
  const panelButton = page.getByRole("button", { name: "Project Browser" });
  await expect(page.locator('.document-tabs [role="tab"]')).toHaveCount(1);
  await panelButton.click();
  const panel = page.getByRole("complementary", { name: "Project Browser" });
  await panel.getByRole("button", { name: "Model", exact: true }).click();
  await panel.getByLabel("Search tree").fill("Beam");
  await expect(panel).toContainText("Synthetic Beam");
  const hashA = await page.evaluate(() => (window as any).viewer.modelHash);

  const original = (await readFile(fixture!)).toString();
  expect(original).toContain("Synthetic Beam");
  await page.locator('input[type="file"]').setInputFiles({ name: "browser-b.ifc", mimeType: "application/octet-stream",
    buffer: Buffer.from(original.replace("Synthetic Beam", "Model B Beam")) });
  await expect(page.locator('.document-tabs [role="tab"]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).viewer.modelHash)).not.toBe(hashA);
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/model/runtime")).json()).coldIndexStatus),
    { timeout: 60_000 }).toBe("ready");
  await panel.getByRole("button", { name: "Model", exact: true }).click();
  await panel.getByLabel("Search tree").fill("Beam");
  await expect(panel).toContainText("Model B Beam");
  await expect(panel).not.toContainText("Synthetic Beam");

  await page.locator('.document-tabs [role="tab"]').first().click();
  await expect.poll(() => page.evaluate(() => (window as any).viewer.modelHash)).toBe(hashA);
  await panel.getByRole("button", { name: "Model", exact: true }).click();
  await panel.getByLabel("Search tree").fill("Beam");
  await expect(panel).toContainText("Synthetic Beam");
  await expect(panel).not.toContainText("Model B Beam");
});

test("a late Tree response from IFC A cannot replace IFC B", async ({ page }) => {
  test.skip(!fixture, "Set IFC_E2E_BIM_FIXTURE to a BIM IFC fixture");
  test.setTimeout(90_000);
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await page.locator('input[type="file"]').setInputFiles(fixture!);
  await expect(page.locator('.document-tabs [role="tab"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).viewer?.modelHash)).toMatch(/^[0-9a-f]{64}$/);
  const hashA = await page.evaluate(() => (window as any).viewer.modelHash);
  let releaseA: (() => void) | undefined;
  await page.route("**/model/browser?**", async route => {
    if (new URL(route.request().url()).searchParams.get("modelHash") === hashA) {
      await new Promise<void>(resolve => { releaseA = resolve; });
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Project Browser" }).click();
  const panel = page.getByRole("complementary", { name: "Project Browser" });
  await panel.getByRole("button", { name: "Model", exact: true }).click();
  await expect.poll(() => Boolean(releaseA), { timeout: 10_000 }).toBe(true);

  const original = (await readFile(fixture!)).toString();
  await page.locator('input[type="file"]').setInputFiles({ name: "browser-b.ifc", mimeType: "application/octet-stream",
    buffer: Buffer.from(original.replace("Synthetic Beam", "Model B Beam")) });
  await expect.poll(() => page.evaluate(() => (window as any).viewer.modelHash)).not.toBe(hashA);
  await expect(panel.getByLabel("Search tree")).toBeEnabled();
  await panel.getByLabel("Search tree").fill("Beam");
  await expect(panel).toContainText("Model B Beam");
  releaseA?.();
  await expect(panel).not.toContainText("Synthetic Beam");
});
