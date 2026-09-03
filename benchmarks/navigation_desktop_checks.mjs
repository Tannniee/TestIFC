import { expect } from "../frontend/node_modules/@playwright/test/index.mjs";

export async function checkDesktopNavigation(page) {
  const orbit = page.getByRole("button", {name:"Chọn cấu kiện làm tâm xoay",exact:true});
  await orbit.click(); await expect(orbit).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", {name:"Project Browser",exact:true}).click();
  await page.getByRole("button", {name:"Model",exact:true}).click();
  await expect.poll(() => page.getByRole("treeitem").count()).toBeGreaterThan(0);
  for (let i=0;i<12 && !await page.locator('[role=treeitem][data-local-id="58"]').count();i++) {
    const expand = page.locator('.tree-expand[aria-expanded="false"]').first();
    if (!await expand.count()) break;
    await expand.click();
  }
  await page.locator('[role=treeitem][data-local-id="58"]').click();
  await expect(page.locator(".properties-panel")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const browser = document.querySelector(".project-browser").getBoundingClientRect();
    return document.querySelector(".viewer-toolbar").getBoundingClientRect().left - browser.right;
  })).toBeCloseTo(12,0);
  await page.getByRole("button", {name:"Cài đặt hiển thị",exact:true}).click();
  await page.getByRole("slider", {name:"Tốc độ xoay",exact:true}).fill("0.75");
  await expect.poll(() => page.evaluate(async () => (await window.pywebview.api.load_settings()).rotationSpeed)).toBe(0.75);
  await page.evaluate(() => localStorage.removeItem("ifc-viewer-rotation-speed"));
  await page.reload();
  await page.waitForSelector(".viewer-mount canvas");
  await page.getByRole("button", {name:"Cài đặt hiển thị",exact:true}).click();
  await expect(page.getByRole("slider", {name:"Tốc độ xoay",exact:true})).toHaveValue("0.75");
  return {browserToolboxGap:12, selectedLocalId:58, rotationSpeed:0.75, desktopPersistence:true};
}
