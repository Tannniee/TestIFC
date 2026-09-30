import { expect, test } from "@playwright/test";

test("Mapbox opens from its own rail icon and settings reject secret tokens", async ({ page }) => {
  await page.goto("/");
  const mapButton = page.getByRole("button", { name: "BIM–GIS Mapbox", exact: true });
  await mapButton.click();
  await expect(mapButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Mở Cài đặt Mapbox" })).toBeVisible();
  await page.getByRole("button", { name: "Mở Cài đặt Mapbox" }).click();
  const input = page.getByLabel("Public access token (pk.)");
  await input.fill("sk.private-key");
  await expect(page.getByRole("button", { name: "Lưu key", exact: true })).toBeDisabled();
  await input.fill("pk.public-test-key");
  await expect(page.getByRole("button", { name: "Lưu key", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Hiện key", exact: true }).click();
  await expect(input).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ẩn key", exact: true }).click();
  await expect(input).toHaveAttribute("type", "password");
  await page.locator(".viewer-settings__header button").click();
  await page.getByRole("button", { name: "Về IFC viewer", exact: true }).click();
  await expect(mapButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".viewer-mount")).toHaveCSS("visibility", "visible");
});

// Network + real IFC integration moved to mapbox-smoke.mjs. It starts its own
// authenticated bridge and checks the actual legacy converter and renderer.
// Existing gis-footprint / gis-placement unit tests retain CRS math coverage.

test("an IFC.js WASM failure reports an error while the regular viewer stays usable", async ({ page }) => {
  const fixture = process.env.IFC_E2E_BIM_FIXTURE;
  test.skip(!fixture, "Set IFC_E2E_BIM_FIXTURE");
  await page.route("**/vendor/bim-gis/web-ifc.wasm", route => route.fulfill({
    contentType: "application/wasm", body: "deliberately-invalid-test-wasm",
  }));
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture!);
  await expect(page.locator(".qn-status-bar")).toContainText("phase3-bim.ifc", { timeout: 30000 });
  await page.getByRole("button", { name: "BIM–GIS Mapbox", exact: true }).click();
  await expect(page.locator(".map-controls .error")).toContainText("Không chuyển được IFC bằng IFC.js", { timeout: 30000 });
  await page.getByRole("button", { name: "Về IFC viewer", exact: true }).click();
  await expect(page.locator(".viewer-mount")).toHaveCSS("visibility", "visible");
  await expect(page.getByRole("button", { name: "Thu cả mô hình vào khung", exact: true })).toBeEnabled();
});
