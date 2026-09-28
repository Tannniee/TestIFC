import { expect, test } from "@playwright/test";

const fixture = process.env.IFC_E2E_BIM_FIXTURE;

test("Project Browser switches semantic views and tree actions update model visibility", async ({ page }) => {
  test.skip(!fixture, "Set IFC_E2E_BIM_FIXTURE to a BIM IFC fixture");
  test.setTimeout(90_000);
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => {
    (window as any).viewer = event.detail;
  }));
  await page.goto("/?viewerDebug=1");
  await page.locator('input[type="file"]').setInputFiles(fixture!);
  await expect.poll(() => page.evaluate(async () => (await (await fetch("/model/runtime")).json()).coldIndexStatus),
    { timeout: 60_000 }).toBe("ready");
  await page.getByRole("button", { name: "Project Browser" }).click();
  const panel = page.getByRole("complementary", { name: "Project Browser" });
  await panel.getByRole("button", { name: "Model" }).click();
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
  await panel.getByText("GIS · Manual anchor").click();
  await panel.getByLabel("GIS longitude").fill("105.8");
  await panel.getByLabel("GIS latitude").fill("21.0");
  await panel.getByLabel("GIS elevation").fill("12.5");
  await panel.getByLabel("GIS rotation").fill("30");
  await panel.getByRole("button", { name: "Save anchor" }).click();
  await expect(panel).toContainText("Vị trí thủ công");
  const anchor = await page.evaluate(async () => {
    const hash = (window as any).viewer.modelHash;
    return (await fetch(`/model/gis-anchor?modelHash=${hash}`)).json();
  });
  expect(anchor).toMatchObject({ status: "manual", source: "manual",
    anchor: { longitude: 105.8, latitude: 21, elevationMeters: 12.5, rotationDegrees: 30, scale: 1 } });
  await panel.getByRole("button", { name: "Xem trên bản đồ" }).click();
  const map = panel.getByLabel("GIS anchor map preview");
  await expect(map).toContainText("21.000000°, 105.800000°");
  await expect(map.locator(".maplibregl-marker")).toHaveCount(1);
  await map.getByRole("button", { name: "Offline view" }).click();
  await expect(map).toContainText("Nền trống");
  await panel.getByRole("button", { name: "Delete anchor" }).click();
  await expect(panel).toContainText("Chưa có vị trí thủ công");
});
