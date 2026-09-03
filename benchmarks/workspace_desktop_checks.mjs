import { expect } from "../frontend/node_modules/@playwright/test/index.mjs";
import path from "node:path";

/** UI-only checks against the production bundle in the real WebView2 host. */
export async function checkDesktopWorkspace(page, { modelA, modelB, output }) {
  if (!modelA || !modelB) throw new Error("Workspace desktop gate needs both A/B IFC paths");
  const docs = page.locator(".document-tabs [role=tab]");
  const initialMetrics = await page.evaluate(() => window.__smokeMetrics.length);
  const draw = async () => {
    await page.getByRole("button", {name:"Section Box",exact:true}).click();
    await expect(page.locator(".viewer-mount")).toHaveClass(/viewer-box-zoom-active/);
    const rect = await page.locator(".viewer-mount canvas").boundingBox();
    await page.mouse.move(rect.x+rect.width*.3,rect.y+rect.height*.3); await page.mouse.down();
    await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.7,{steps:8}); await page.mouse.up();
    await expect(page.getByRole("tab",{name:"Section Box 1",exact:true})).toHaveAttribute("aria-selected","true");
  };
  const bounds = () => page.locator(".viewer-section-box-panel input[type=number]").evaluateAll(inputs => inputs.map(input=>input.value));
  await draw();
  const xMin = page.getByRole("spinbutton", {name:"Section Box X min",exact:true});
  const xMax = page.getByRole("spinbutton", {name:"Section Box X max",exact:true});
  const changed = Number(await xMin.inputValue()) + (Number(await xMax.inputValue()) - Number(await xMin.inputValue()))*.1;
  await xMin.fill(String(changed)); await xMin.press("Tab");
  const boxBeforeDrag = await bounds();
  const handle = page.locator('.section-box-handle[data-section-face="x-min"]');
  const h = await handle.boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2); await page.mouse.down();
  await page.mouse.move(h.x+35,h.y+25,{steps:5}); await page.mouse.up();
  const box = await bounds(); expect(box).not.toEqual(boxBeforeDrag);
  await page.getByRole("checkbox", {name:"Show Handles"}).uncheck();
  await expect(page.locator(".section-box-handle:visible")).toHaveCount(0);
  await page.getByRole("checkbox", {name:"Show Handles"}).check();
  await page.screenshot({path:path.join(output,"workspace-light.png")});
  await page.getByRole("tab",{name:"3D View",exact:true}).click();
  await page.getByRole("tab",{name:"Section Box 1",exact:true}).click();
  await expect.poll(bounds).toEqual(box);
  expect(await page.evaluate(() => window.__smokeMetrics.length)).toBe(initialMetrics);
  await page.locator("input[type=file]").setInputFiles(modelA);
  await expect(docs).toHaveCount(2); await expect(docs.nth(1)).toHaveAttribute("aria-selected","true",{timeout:120000});
  await docs.nth(0).click(); await expect(docs.nth(0)).toHaveAttribute("aria-selected","true",{timeout:60000});
  if (!await page.locator(".properties-panel").isVisible()) await page.getByRole("button",{name:"Mở/đóng bảng thuộc tính",exact:true}).click();
  await expect.poll(bounds).toEqual(box);
  expect(await page.evaluate(() => window.__smokeMetrics.at(-1).cacheHit)).toBe(true);
  await page.getByRole("tab",{name:"3D View",exact:true}).click();
  await page.getByRole("button", {name:"Project Browser",exact:true}).click();
  await page.getByRole("button", {name:"Model",exact:true}).click();
  await expect.poll(() => page.getByRole("treeitem").count()).toBeGreaterThan(0);
  // Reveal actual children, then select from the virtualized browser.
  for (let i=0;i<12 && !(await page.locator('[role=treeitem][data-local-id="58"]').count());i++) {
    const expand = page.locator('.tree-expand[aria-expanded="false"]').first();
    if (!await expand.count()) break; await expand.click();
  }
  const element = page.locator('[role=treeitem][data-local-id="58"]');
  await expect(element).toBeVisible(); await element.click();
  await page.getByRole("button", {name:"Attributes",exact:true}).click();
  await expect.poll(() => page.locator(".property-group dd").count()).toBeGreaterThan(0);
  await page.getByRole("button", {name:"Close Project Browser",exact:true}).click();
  await page.getByRole("button", {name:"Close Properties",exact:true}).click();
  await page.getByRole("button", {name:"Đo kích thước",exact:true}).click();
  const canvas = await page.locator(".viewer-mount canvas").boundingBox();
  let clicked;
  for (const [x,y] of [[.5,.5],[.4,.5],[.6,.5],[.5,.4],[.5,.6], ...Array.from({length:49},(_,i)=>[.2+(i%7)*.1,.2+Math.floor(i/7)*.1])]) {
    clicked = {x:canvas.x+canvas.width*x,y:canvas.y+canvas.height*y};
    await page.mouse.click(clicked.x,clicked.y); await page.waitForTimeout(150); await page.keyboard.press("1");
    if (await page.getByRole("textbox",{name:"Measurement distance"}).isVisible()) break;
  }
  const entry = page.getByRole("textbox",{name:"Measurement distance"});
  await expect(entry).toBeVisible();
  const entryBox = await entry.boundingBox();
  expect(Math.hypot(entryBox.x-clicked.x,entryBox.y-clicked.y)).toBeLessThan(250);
  await entry.fill("1000"); await entry.press("Enter");
  await page.screenshot({path:path.join(output,"measurement-near-point.png")});
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.getByRole("button", {name:"Chuyển sang nền tối",exact:true}).click();
  await page.setViewportSize({width:900,height:600});
  await page.getByRole("tab",{name:"Section Box 1",exact:true}).click();
  // Opening the box view restores Properties when needed via the normal rail.
  if (!await page.locator(".properties-panel").isVisible()) await page.getByRole("button",{name:"Mở/đóng bảng thuộc tính",exact:true}).click();
  await page.locator(".properties-panel").evaluate(async element => { await Promise.all(element.getAnimations().map(a=>a.finished.catch(()=>{}))); });
  await page.screenshot({path:path.join(output,"workspace-dark-small.png")});
  expect(await page.locator(".viewer-mount canvas").count()).toBe(1);
  while (await docs.count()) { const count = await docs.count(); await page.locator(".document-tabs .tab-close").last().click(); await expect(docs).toHaveCount(count-1,{timeout:60000}); }
  const backend = await page.evaluate(async () => {
    const {token} = await window.pywebview.api.get_api_session();
    return (await fetch("/model/runtime",{headers:{"X-IFC-Session":token}})).json();
  });
  expect(backend.hasActiveModel).toBe(false);
  await page.locator("input[type=file]").setInputFiles(modelB);
  await expect(docs).toHaveCount(1); await expect(page.getByRole("tab",{name:"3D View",exact:true})).toBeEnabled({timeout:60000});
  expect(await page.evaluate(() => window.__smokeMetrics.at(-1).cacheHit)).toBe(true);
  return {box,measurementEntryOffset:{x:entryBox.x-clicked.x,y:entryBox.y-clicked.y},smallViewport:{width:900,height:600},
    productionBundle:true,metrics:await page.evaluate(() => window.__smokeMetrics),closedLastBackend:true};
}
