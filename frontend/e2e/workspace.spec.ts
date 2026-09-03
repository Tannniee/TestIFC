import { expect, test } from "@playwright/test";

const modelA = process.env.IFC_E2E_MODEL_A;
const modelB = process.env.IFC_E2E_MODEL_B;

async function workspacePage(page: import("@playwright/test").Page, profile = "full") {
  await page.addInitScript(() => {
    const root = window as any; root.metrics = [];
    window.addEventListener("ifc-fragment-metrics", (event: any) => root.metrics.push(event.detail));
    window.addEventListener("ifc-viewer-ready", (event: any) => {
      root.viewer = event.detail; root.loadResult = "idle";
      const load = root.viewer.load.bind(root.viewer);
      root.viewer.load = (...args: any[]) => {
        root.loadResult = "loading";
        return load(...args).then(() => { root.loadResult = "ready"; }, (error: Error) => { root.loadResult = `${error.name}:${error.message}`; throw error; });
      };
    });
  });
  await page.goto(`/?viewerDebug=1&fragmentProfile=${profile}`);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).viewer))).toBe(true);
}
async function openModel(page: import("@playwright/test").Page, path: string) {
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect.poll(() => page.evaluate(() => (window as any).loadResult), {timeout:60000}).toBe("ready");
  await expect(page.locator(".view-tabs button[role=tab]").first()).toBeEnabled();
}

test("multi IFC restores A/B state, deduplicates content, recovers deleted cache and closes the last backend model", async ({page}, testInfo) => {
  test.skip(!modelA || !modelB, "Set two private IFC paths"); test.setTimeout(180000);
  const errors: string[]=[]; page.on("pageerror", e=>errors.push(e.message));
  await workspacePage(page); await openModel(page,modelA!);
  const savedA = await page.evaluate(async () => {
    const v=(window as any).viewer;
    (window as any).renderer=v.renderer;
    const ids=(await v.model.getItemsIdsWithGeometry()).slice(0,2); await v.selectItems(ids);
    v.fitSectionBox();
    v.interaction.restoreMeasurements([{id:3,mode:"pointToPoint",start:{...v.model.box.min},end:{...v.model.box.max},distance:v.model.box.min.distanceTo(v.model.box.max)}]);
    return v.captureViewState();
  });
  await openModel(page,modelB!);
  const savedB=await page.evaluate(async()=>{
    const v=(window as any).viewer;
    await v.selectItems((await v.model.getItemsIdsWithGeometry()).slice(0,1));
    return v.captureViewState();
  });
  const docs=page.locator('.document-tabs [role="tab"]');
  await expect(docs).toHaveCount(2);
  await docs.nth(0).click(); await expect(docs.nth(0)).toHaveAttribute("aria-selected","true");
  await expect.poll(()=>page.evaluate(()=>(window as any).viewer.captureViewState())).toEqual(savedA);
  await docs.nth(1).click(); await expect(docs.nth(1)).toHaveAttribute("aria-selected","true");
  await expect.poll(()=>page.evaluate(()=>(window as any).viewer.captureViewState())).toEqual(savedB);
  const duplicate=await page.evaluate(()=>{const v=(window as any).viewer; (window as any).beforeDuplicate=v.model; return (window as any).metrics.length;});
  // A renamed file containing B's identical bytes must activate the existing document.
  const fs=await import("node:fs/promises");
  await page.locator('input[type="file"]').setInputFiles({name:"B-renamed.ifc",mimeType:"application/octet-stream",buffer:await fs.readFile(modelB!)});
  await expect.poll(()=>page.evaluate(()=>(window as any).loadResult)).toBe("ready");
  await expect(docs).toHaveCount(2);
  expect(await page.evaluate(()=>(window as any).viewer.model===(window as any).beforeDuplicate)).toBe(true);
  expect(await page.evaluate(()=>(window as any).metrics.length)).toBe(duplicate);
  await docs.nth(0).click(); await expect(docs.nth(0)).toHaveAttribute("aria-selected","true");
  // Only the isolated test backend/cache is affected.
  const cleared=await page.evaluate(async()=>{
    const response=await fetch("/model/cache/clear",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope:"all"})});
    return {status:response.status,body:await response.json()};
  });
  expect(cleared.status).toBe(200);
  await docs.nth(1).click(); await expect(docs.nth(1)).toHaveAttribute("aria-selected","true");
  const rebuilt=await page.evaluate(async()=>{
    const root=window as any,v=root.viewer;
    return {state:v.captureViewState(),last:root.metrics.at(-1),models:v.loader.fragments.models.list.size,sameRenderer:v.renderer===root.renderer,
      backend:(await(await fetch("/model/runtime")).json()).activeModelHash,hash:v.modelHash};
  });
  expect(rebuilt.last.cacheHit).toBe(false); expect(rebuilt.models).toBe(1); expect(rebuilt.sameRenderer).toBe(true); expect(rebuilt.backend).toBe(rebuilt.hash);
  // GUID-backed identity survives a rebuilt artifact (artifact digest may differ).
  expect(rebuilt.state.camera).toEqual(savedB.camera); expect(rebuilt.state.selection.map((r:any)=>r.globalId)).toEqual(savedB.selection.map((r:any)=>r.globalId));
  await page.locator(".document-tabs .tab-close").nth(0).click(); await expect(docs).toHaveCount(1);
  await page.locator(".document-tabs .tab-close").click(); await expect(docs).toHaveCount(0);
  expect(await page.evaluate(async()=>({models:(window as any).viewer.loader.fragments.models.list.size,
    backend:(await(await fetch("/model/runtime")).json()).activeModelHash,labels:document.querySelectorAll(".viewer-measurement-label").length}))).toEqual({models:0,backend:null,labels:0});
  await openModel(page,modelB!); await expect(docs).toHaveCount(1);
  expect(errors).toEqual([]);
  await testInfo.attach("multi-ifc",{body:JSON.stringify({cleared,rebuilt},null,2),contentType:"application/json"});
});

test("deleted source survives a warm cache, offers reselect after eviction and retains views by content hash", async ({page}, testInfo) => {
  test.skip(!modelA || !modelB); test.setTimeout(150000);
  const fs = await import("node:fs/promises");
  const source = testInfo.outputPath("retained-source.ifc");
  await fs.copyFile(modelB!, source);
  await workspacePage(page); await openModel(page, source);
  const saved = await page.evaluate(async () => {
    const v = (window as any).viewer;
    await v.selectItems((await v.model.getItemsIdsWithGeometry()).slice(0, 2)); v.fitSectionBox();
    return v.captureViewState();
  });
  await openModel(page, modelA!);
  await fs.unlink(source);
  const docs = page.locator(".document-tabs [role=tab]");
  await docs.nth(0).click(); await expect(docs.nth(0)).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => (window as any).metrics.at(-1).cacheHit)).toBe(true);
  await docs.nth(1).click(); await expect(docs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.evaluate(async () => { await fetch("/model/cache/clear", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope:"all"})}); });
  await docs.nth(0).click();
  const reselect = page.getByRole("button", {name:"Chọn lại IFC retained-source.ifc", exact:true});
  await expect(reselect).toBeVisible();
  await expect(docs.nth(1)).toHaveAttribute("aria-selected", "true");
  // Selecting different contents does not replace the missing document's Views.
  const original = await fs.readFile(modelB!);
  const changed = Buffer.from(original.toString().replace("END-ISO-10303-21;", "/* workspace source changed */\nEND-ISO-10303-21;"));
  const picker = page.waitForEvent("filechooser"); await reselect.click();
  await (await picker).setFiles({name:"retained-source.ifc",mimeType:"application/octet-stream",buffer:changed});
  await expect(docs).toHaveCount(3); await expect(docs.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(reselect).toBeVisible();
  const samePicker = page.waitForEvent("filechooser"); await reselect.click();
  await (await samePicker).setFiles({name:"source-found.ifc",mimeType:"application/octet-stream",buffer:original});
  await expect(docs.nth(0)).toHaveAttribute("aria-selected", "true"); await expect(docs).toHaveCount(3);
  await expect(reselect).toHaveCount(0);
  const restored = await page.evaluate(() => (window as any).viewer.captureViewState());
  expect(restored.camera).toEqual(saved.camera); expect(restored.clipping).toEqual(saved.clipping);
  expect(restored.selection.map((ref:any) => ref.globalId)).toEqual(saved.selection.map((ref:any) => ref.globalId));
});

test("rollback conflict preserves the newer backend generation until explicit recovery, then documents work again", async ({page}) => {
  test.skip(!modelA || !modelB); test.setTimeout(120000);
  await workspacePage(page); await openModel(page, modelA!);
  const saved = await page.evaluate(async () => {
    const v = (window as any).viewer; await v.selectItems((await v.model.getItemsIdsWithGeometry()).slice(0,1));
    v.fitSectionBox(); return v.captureViewState();
  });
  await page.evaluate(() => {
    const root = window as any, loader = root.viewer.loader, update = loader.callbacks.update;
    loader.callbacks.update = async () => {
      loader.callbacks.update = update;
      const {api} = await import(/* @vite-ignore */ "/src/lib/api.ts");
      const current = await api.runtime(); root.otherActivation = await api.activateModel(current.activeModelHash!);
      throw new Error("injected concurrent activation after commit");
    };
  });
  await page.locator("input[type=file]").setInputFiles(modelB!);
  await expect(page.locator(".viewer-empty-state-error")).toContainText("Không xác nhận được khôi phục INDEX");
  const conflict = await page.evaluate(async () => {
    const root = window as any;
    return {state:root.viewer.captureViewState(),backend:await(await fetch("/model/runtime")).json(),other:root.otherActivation,
      models:root.viewer.loader.fragments.models.list.size};
  });
  expect(conflict.state).toEqual(saved); expect(conflict.models).toBe(1);
  expect(conflict.backend.activeLoadedAt).toBe(conflict.other.loadedAt);
  await page.locator(".semantic-status button").click();
  await expect.poll(() => page.evaluate(() => (window as any).viewer.needsModelRecovery)).toBe(false);
  await expect(page.locator(".view-tabs [role=tab]").first()).toBeEnabled();
  const recovered = await page.evaluate(async () => {
    const v = (window as any).viewer, backend = await(await fetch("/model/runtime")).json();
    return {state:v.captureViewState(),hash:backend.activeModelHash,generation:backend.activeLoadedAt,session:v.loader.identity.activation.loadedAt};
  });
  expect(recovered.state).toEqual(saved); expect(recovered.hash).toBe(saved.selection[0].modelHash);
  expect(recovered.generation).toBe(recovered.session);
  await page.locator(".document-tabs [role=tab]").nth(1).click();
  await expect(page.locator(".document-tabs [role=tab]").nth(1)).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => (window as any).viewer.loader.fragments.models.list.size)).toBe(1);
});

test("failed worker disposal stays hidden and is retried before another document can load", async ({page}) => {
  test.skip(!modelA || !modelB); test.setTimeout(120000);
  await workspacePage(page); await openModel(page, modelA!);
  await page.evaluate(() => {
    const root = window as any, v = root.viewer, fragments = v.loader.fragments, dispose = fragments.disposeModel.bind(fragments);
    const previous = v.model.modelId; root.previousModel = v.model;
    fragments.disposeModel = async (id:string) => {
      if (id === previous) { fragments.disposeModel = dispose; throw new Error("injected disposal failure"); }
      return dispose(id);
    };
  });
  await openModel(page, modelB!);
  await expect(page.locator(".semantic-status button")).toBeVisible();
  expect(await page.evaluate(() => (window as any).previousModel.object.visible)).toBe(false);
  await page.locator(".semantic-status button").click();
  await expect.poll(() => page.evaluate(() => (window as any).viewer.loader.fragments.models.list.size)).toBe(1);
  await page.locator(".document-tabs [role=tab]").nth(0).click();
  await expect(page.locator(".document-tabs [role=tab]").nth(0)).toHaveAttribute("aria-selected", "true");
});

for (const profile of ["attributes", "minimum"]) test(`Browser and Properties provide a safe fallback for the ${profile} fragment profile`, async ({page}) => {
  test.skip(!modelB); test.setTimeout(90000);
  await workspacePage(page, profile); await openModel(page, modelB!);
  await page.getByRole("button", {name:"Project Browser",exact:true}).click();
  await page.getByRole("button", {name:"Model",exact:true}).click();
  await expect.poll(() => page.getByRole("treeitem").count()).toBeGreaterThan(0);
  await page.evaluate(async () => { const v=(window as any).viewer; await v.selectItems((await v.model.getItemsIdsWithGeometry()).slice(0,1)); });
  await page.getByRole("button", {name:"Psets / Quantities",exact:true}).click();
  await expect(page.locator(".properties-body")).toContainText("Không có dữ liệu quan hệ");
  await expect(page.locator(".project-browser [role=alert]")).toHaveCount(0);
});

test("real duplicate and missing GUIDs retain exact-artifact selection and are skipped safely after an artifact change", async ({page}) => {
  const fixture = process.env.IFC_E2E_IDENTITY_MODEL;
  test.skip(!fixture); test.setTimeout(90000);
  await workspacePage(page); await openModel(page, fixture!);
  const result = await page.evaluate(async () => {
    const v = (window as any).viewer, model = v.model;
    const ids = await model.getItemsIdsWithGeometry();
    const [unique] = ids.filter((id:number) => ![58,103,119].includes(id));
    await v.selectItems([58,103,119,unique]);
    const original = v.captureViewState(); await v.clearSelection(); await v.applyViewState(original);
    const exact = v.captureViewState();
    const rebuilt = structuredClone(original); rebuilt.selection.forEach((ref:any) => ref.artifactId = "different-artifact");
    await v.applyViewState(rebuilt);
    return {original,exact,remapped:v.captureViewState().selection,unique,guids:await model.getGuidsByLocalIds([58,103,119])};
  });
  expect(result.guids[0]).toBe(result.guids[1]); expect(result.guids[2]).toBeNull();
  expect(result.exact).toEqual(result.original);
  expect(result.remapped.map((ref:any) => ref.localId)).toEqual([result.unique]);
});

test("two independent boxes handle empty sweep, pointer cancellation and closing during creation", async ({page}) => {
  test.skip(!modelB); test.setTimeout(90000);
  await workspacePage(page); await openModel(page, modelB!);
  const source = await page.evaluate(() => (window as any).viewer.captureViewState());
  const draw = async (start:number,end:number) => {
    await page.getByRole("button", {name:"Section Box",exact:true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).viewer.boxZoomActive)).toBe(true);
    const rect = (await page.locator(".viewer-mount canvas").boundingBox())!;
    await page.mouse.move(rect.x+rect.width*start,rect.y+rect.height*start); await page.mouse.down();
    await page.mouse.move(rect.x+rect.width*end,rect.y+rect.height*end,{steps:5}); await page.mouse.up();
  };
  await draw(.3,.7);
  const first = page.getByRole("tab", {name:"Section Box 1",exact:true});
  await expect(first).toHaveAttribute("aria-selected","true");
  const firstState = await page.evaluate(() => (window as any).viewer.captureViewState());
  await draw(.4,.6);
  const second = page.getByRole("tab", {name:"Section Box 2",exact:true});
  await expect(second).toHaveAttribute("aria-selected","true");
  const secondState = await page.evaluate(() => (window as any).viewer.captureViewState());
  expect(secondState.clipping).not.toEqual(firstState.clipping);
  const handle = page.locator('.section-box-handle[data-section-face="x-min"]');
  const rect = (await handle.boundingBox())!;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2); await page.mouse.down(); await page.mouse.move(rect.x+45,rect.y+25);
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).viewer.captureViewState())).toEqual(secondState);
  await draw(.01,.06);
  await expect(page.locator(".viewer-empty-state-error")).toContainText("Vùng quét nằm ngoài mô hình");
  await expect(page.locator(".view-tabs [role=tab]")).toHaveCount(3);
  await page.getByRole("button", {name:"Close Section Box 2",exact:true}).click();
  await expect(second).toHaveCount(0); await expect(first).toHaveAttribute("aria-selected","true");
  expect(await page.evaluate(() => (window as any).viewer.captureViewState())).toEqual(firstState);
  await page.getByRole("tab",{name:"3D View",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).viewer.captureViewState())).toEqual(source);
  expect(await page.evaluate(() => (window as any).metrics.length)).toBe(1);
});

test("Browser builds on demand, selects elements and queries real IFC properties only when requested",async({page},testInfo)=>{
  test.skip(!modelB,"Set a private IFC path"); test.setTimeout(90000);
  await workspacePage(page); await openModel(page,modelB!);
  await page.evaluate(()=>{
    const v=(window as any).viewer,m=v.model; (window as any).treeRequests=0;
    const tree=m.getSpatialStructure.bind(m); m.getSpatialStructure=(...args:any[])=>{(window as any).treeRequests++;return tree(...args);};
  });
  expect(await page.evaluate(()=>(window as any).treeRequests)).toBe(0);
  await page.getByRole("button",{name:"Project Browser",exact:true}).click();
  await page.getByRole("button",{name:"Model",exact:true}).click();
  await expect.poll(()=>page.getByRole("treeitem").count()).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).treeRequests)).toBe(1);
  const probe=await page.evaluate(async()=>{
    const v=(window as any).viewer;
    const ids=await v.model.getItemsIdsWithGeometry();
    await v.selectItems([ids[0]]);
    return {ids,selection:v.captureViewState().selection};
  });
  await page.getByTitle("Reveal selected element").click();
  await expect(page.getByRole("treeitem",{selected:true})).toHaveCount(1);
  // Browser click takes the same selection path as picking the viewport.
  await page.evaluate(async()=>{await (window as any).viewer.clearSelection();});
  await page.locator(`[role=treeitem][data-local-id="${probe.ids[0]}"]`).click();
  await expect(page.locator(".properties-panel h3")).not.toHaveText("3D View");
  await page.getByRole("button",{name:"Attributes",exact:true}).click();
  await expect.poll(()=>page.locator(".property-group dd").count()).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Psets / Quantities",exact:true}).click();
  await expect(page.locator(".properties-body")).not.toContainText("Loading…");
  await expect(page.locator(".properties-body [role=alert]")).toHaveCount(0);
  const properties=await page.locator(".properties-body").innerText();
  // Both private A/B exports contain no IfcPropertySet; show an explicit empty result.
  expect(properties).toContain("Không có dữ liệu quan hệ");
  await page.screenshot({path:testInfo.outputPath("browser-properties.png")});
  await testInfo.attach("properties",{body:JSON.stringify({probe,properties}),contentType:"application/json"});
  expect(await page.getByRole("treeitem").count()).toBeLessThanOrEqual(50);
});

test("Properties resolves Psets, quantities and materials; late results cannot overwrite a new selection",async({page})=>{
  const fixture=process.env.IFC_E2E_PROPERTIES_MODEL;
  test.skip(!fixture,"Set enriched isolated IFC fixture"); test.setTimeout(90000);
  await workspacePage(page); await openModel(page,fixture!);
  await page.evaluate(async()=>{await (window as any).viewer.selectItems([58]);});
  await page.getByRole("button",{name:"Psets / Quantities",exact:true}).click();
  await expect(page.locator(".properties-body")).toContainText("WS-PSET-READY");
  await expect(page.locator(".properties-body")).toContainText("GateLength");
  await page.getByRole("button",{name:"Materials",exact:true}).click();
  await expect(page.locator(".properties-body")).toContainText("WS-STEEL");
  await page.evaluate(()=>{
    const root=window as any,model=root.viewer.model,read=model.getItemsData.bind(model);
    model.getItemsData=async(ids:number[],config:any)=>{
      const result=await read(ids,config);
      if(config?.attributesDefault && config?.relations?.ContainedInStructure){
        root.queryHeld=true;
        await new Promise(resolve=>root.releaseQuery=resolve);
        result[0].GateStale={value:"STALE-RESULT-MUST-NOT-APPEAR"};
      }
      return result;
    };
  });
  await page.getByRole("button",{name:"Location",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).queryHeld)).toBe(true);
  await page.evaluate(async()=>{
    const root=window as any; const ids=await root.viewer.model.getItemsIdsWithGeometry();
    await root.viewer.selectItems([ids.find((id:number)=>id!==58)]); root.releaseQuery();
  });
  await expect(page.locator(".properties-body")).not.toContainText("STALE-RESULT-MUST-NOT-APPEAR");
  await expect(page.locator(".property-group")).toHaveCount(0);
});

test("pending document tabs cancel cleanly, failed neighbor keeps the active view, and latest activation wins", async({page})=>{
  test.skip(!modelA || !modelB, "Set private IFC paths"); test.setTimeout(120000);
  await workspacePage(page); await openModel(page,modelA!);
  const original=await page.evaluate(()=>{
    const root=window as any; root.original=root.viewer.model;
    return {hash:root.viewer.modelHash,state:root.viewer.captureViewState()};
  });
  await page.evaluate(()=>{
    const root=window as any,bridge=root.viewer.loader.bridge;
    root.getFragments=bridge.fragments.bind(bridge);
    bridge.fragments=()=>{root.held=true;return new Promise((_,reject)=>bridge.fragmentRequests.signal.addEventListener("abort",()=>reject(new DOMException("cancelled","AbortError")),{once:true}));};
  });
  await page.locator('input[type=file]').setInputFiles(modelB!);
  await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
  const tabs=page.locator(".document-tabs [role=tab]");
  await expect(tabs).toHaveCount(2);
  await page.locator(".document-tabs .tab-close").nth(1).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.locator("dialog.model-load-dialog")).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).viewer.model===(window as any).original)).toBe(true);
  await page.evaluate(()=>{const root=window as any;root.viewer.loader.bridge.fragments=root.getFragments;});
  await openModel(page,modelB!);
  // Loading the neighbor fails: closing B must not discard B or its saved state.
  await page.route("**/model/fragments/*",route=>route.request().method()==="GET"?route.fulfill({status:500,body:"neighbor activation failed"}):route.continue());
  await page.locator(".document-tabs .tab-close").nth(1).click();
  await expect(page.locator(".viewer-empty-state-error")).toContainText("neighbor activation failed");
  await expect(tabs).toHaveCount(2); await expect(tabs.nth(1)).toHaveAttribute("aria-selected","true");
  await page.unroute("**/model/fragments/*");
  // A/B/A requested rapidly through real document tabs. Only the final A may commit.
  await tabs.nth(0).click(); await tabs.nth(1).click(); await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected","true");
  await expect(page.locator(".view-tabs [role=tab]").first()).toBeEnabled();
  const final=await page.evaluate(async()=>{
    const v=(window as any).viewer;return {state:v.captureViewState(),hash:v.modelHash,models:v.loader.fragments.models.list.size,
      backend:(await(await fetch("/model/runtime")).json()).activeModelHash};
  });
  expect(final).toEqual({state:original.state,hash:original.hash,backend:original.hash,models:1});
});

test("Section Box creates an independent view, returns to 3D and cancels without changing the source", async ({ page }, testInfo) => {
  test.skip(!modelB, "Set a private IFC path"); test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).viewer = event.detail; }));
  await page.goto("/?viewerDebug=1");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
  await page.locator('input[type="file"]').setInputFiles(modelB!);
  await expect(page.getByRole("tab", { name: "3D View", exact: true })).toBeVisible();
  const source = await page.evaluate(() => JSON.stringify((window as any).viewer.captureViewState()));
  await page.getByRole("button", { name: "Section Box", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (window as any).viewer.sectionBoxCreationActive)).toBe(false);
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).viewer.captureViewState()))).toBe(source);
  await page.getByRole("button", { name: "Section Box", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).viewer.boxZoomActive)).toBe(true);
  const box = await page.locator(".viewer-mount canvas").boundingBox();
  await page.mouse.move(box!.x+box!.width*.3,box!.y+box!.height*.3); await page.mouse.down();
  await page.mouse.move(box!.x+box!.width*.7,box!.y+box!.height*.7,{steps:8}); await page.mouse.up();
  await expect(page.getByRole("tab", { name: "Section Box 1", exact: true })).toHaveAttribute("aria-selected","true");
  await expect.poll(() => page.locator(".section-box-handle:visible").count()).toBe(6);
  const savedBox = await page.evaluate(() => JSON.stringify((window as any).viewer.captureViewState().clipping));
  await page.getByRole("tab", { name: "3D View", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).viewer.captureViewState()))).toBe(source);
  await page.getByRole("tab", { name: "Section Box 1", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).viewer.captureViewState().clipping))).toBe(savedBox);
  const handle = page.locator('[data-section-face="x-max"]'); const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox!.x+14,handleBox!.y+14); await page.mouse.down();
  await page.mouse.move(handleBox!.x+54,handleBox!.y+14,{steps:5});
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).viewer.captureViewState().clipping))).toBe(savedBox);
  await page.screenshot({ path: testInfo.outputPath("section-box-workspace.png") });
  expect(errors).toEqual([]);
});
test("View state restores clipping, multiple selection and measurements without another model load", async ({ page }) => {
  test.skip(!modelB, "Set a private IFC path");
  test.setTimeout(180000);
  page.on("pageerror", error => console.log("PAGE ERROR:", error.message));
  await page.addInitScript(() => window.addEventListener("ifc-viewer-ready", (event: any) => { (window as any).viewer = event.detail; }));
  await page.goto("/?viewerDebug=1");
  await expect(page.locator(".viewer-mount canvas")).toHaveCount(1);
  await page.locator('input[type="file"]').setInputFiles(modelB!);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).viewer?.loader.identity)), { timeout: 30000 }).toBe(true);
  const result = await page.evaluate(async () => {
    const viewer = (window as any).viewer;
    const model = viewer.model;
    const ids = (await model.getItemsIdsWithGeometry()).slice(0, 2);
    await viewer.selectItems(ids);
    viewer.fitSectionBox();
    const start = { ...model.box.min }, end = { ...model.box.max };
    viewer.interaction.restoreMeasurements([{ id: 7, mode: "pointToPoint", start, end, distance: model.box.min.distanceTo(model.box.max) }]);
    const original = JSON.parse(JSON.stringify(viewer.captureViewState()));
    const alternate = structuredClone(original);
    alternate.camera.zoom = 2;
    alternate.camera.effectiveHeight *= .5;
    alternate.clipping = { kind: "none" }; alternate.selection = []; alternate.measurements = [];
    await viewer.applyViewState(alternate);
    const cleared = viewer.captureViewState();
    await viewer.applyViewState(original);
    const restored = viewer.captureViewState();
    return { original, restored, cleared, sameModel: viewer.model === model, count: viewer.loader.fragments.models.list.size,
      labels: document.querySelectorAll(".viewer-measurement-label").length, selected: viewer.highlights.localIds, ids };
  });
  expect(result.sameModel).toBe(true); expect(result.count).toBe(1);
  expect(result.cleared.selection).toEqual([]); expect(result.cleared.measurements).toEqual([]);
  expect(result.restored).toEqual(result.original);
  expect(result.selected).toEqual(result.ids); expect(result.labels).toBe(1);
});

test("six handles, numeric bounds and display toggles share one box; partial view failure restores the committed view",async({page},testInfo)=>{
  test.skip(!modelB,"Set a private IFC path"); test.setTimeout(90000);
  await workspacePage(page); await openModel(page,modelB!);
  await page.getByRole("button",{name:"Section Box",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).viewer.boxZoomActive)).toBe(true);
  const canvas=(await page.locator(".viewer-mount canvas").boundingBox())!;
  await page.mouse.move(canvas.x+canvas.width*.3,canvas.y+canvas.height*.3);await page.mouse.down();
  await page.mouse.move(canvas.x+canvas.width*.7,canvas.y+canvas.height*.7,{steps:5});await page.mouse.up();
  const boxTab=page.getByRole("tab",{name:"Section Box 1",exact:true});
  await expect(boxTab).toHaveAttribute("aria-selected","true");
  for(const axis of ["x","y","z"])for(const side of ["min","max"]){
    const handle=page.locator(`[data-section-face="${axis}-${side}"]`),position=(await handle.boundingBox())!;
    const before=await page.evaluate(({axis,side})=>(window as any).viewer.sectionBox[side][axis],{axis,side});
    await page.mouse.move(position.x+14,position.y+14);await page.mouse.down();
    const drag=await page.evaluate(()=>{const d=(window as any).viewer.boxController.drag;return d?{dx:d.dx,dy:d.dy,face:d.face}:null;});
    expect(drag?.face).toEqual({axis,side});
    const delta=side==="min"?-12:12;
    await page.mouse.move(position.x+14+drag!.dx*delta,position.y+14+drag!.dy*delta,{steps:3});await page.mouse.up();
    expect(await page.evaluate(({axis,side})=>(window as any).viewer.sectionBox[side][axis],{axis,side})).not.toBe(before);
  }
  const yMax=page.getByRole("spinbutton",{name:"Section Box Y max",exact:true});
  const value=Number(await yMax.inputValue())+1;await yMax.fill(String(value));await yMax.press("Tab");
  expect(await page.evaluate(()=>(window as any).viewer.sectionBox.min.z)).toBeCloseTo(-value,5);
  const state=await page.evaluate(()=>(window as any).viewer.captureViewState());
  await page.getByRole("checkbox",{name:"Show Handles"}).uncheck();
  await expect(page.locator(".section-box-handle:visible")).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).viewer.renderer.clippingPlanes.length)).toBe(6);
  await page.getByRole("checkbox",{name:"Show Handles"}).check();
  await page.evaluate(()=>{
    const v=(window as any).viewer,apply=v.applyViewState.bind(v);
    v.applyViewState=async(state:any)=>{v.applyViewState=apply;await apply(state);throw new Error("injected partial view failure");};
  });
  await page.getByRole("tab",{name:"3D View",exact:true}).click();
  await expect(page.locator(".viewer-empty-state-error")).toContainText("injected partial view failure");
  await expect(boxTab).toHaveAttribute("aria-selected","true");
  expect(await page.evaluate(()=>(window as any).viewer.captureViewState())).toEqual(state);
  await page.getByRole("tab",{name:"3D View",exact:true}).click();
  await expect(page.getByRole("tab",{name:"3D View",exact:true})).toHaveAttribute("aria-selected","true");
  await boxTab.click();await expect(boxTab).toHaveAttribute("aria-selected","true");
  await page.getByRole("button",{name:"Close Section Box 1",exact:true}).click();
  await expect(boxTab).toHaveCount(0);await expect(page.locator(".section-box-handle:visible")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Close 3D View",exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).metrics.length)).toBe(1);
  await page.setViewportSize({width:800,height:500});
  await page.evaluate(()=>document.querySelector(".qn-theme")!.setAttribute("data-mode","dark"));
  await page.locator(".properties-panel").evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(()=>{}))); });
  await page.screenshot({path:testInfo.outputPath("workspace-small-dark.png")});
});

test("selection bridge drains old writes before the new selection and skips obsolete queued queries",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(async()=>{
    const {ViewerBridge}=await import(/* @vite-ignore */ "/src/lib/viewer-bridge.ts");
    const {api}=await import(/* @vite-ignore */ "/src/lib/api.ts");
    const writes:string[]=[];let release!:()=>void;
    const bridge=new ViewerBridge({onProgress(){}});
    api.setSelection=async(p:any)=>{if(p.element.localId===1)await new Promise<void>(resolve=>release=resolve);writes.push(String(p.element.localId));return{};};
    api.clearSelection=async()=>{writes.push("clear");return{};};
    const selection=(id:number)=>({modelId:"a",modelName:"a",localId:id,expressId:id,globalId:null,ifcType:null,objectType:null,description:null,name:null,raw:null});
    const first=bridge.publishSelection(selection(1));
    await Promise.resolve();
    const obsolete=bridge.publishSelection(selection(2),()=>false);
    const clear=bridge.clearSelection();const latest=bridge.publishSelection(selection(3));
    release();await Promise.all([first,obsolete,clear,latest]);return writes;
  });
  expect(result).toEqual(["1","clear","3"]);
});

test("Escape during final box creation restores source measurements and selection before another view can start",async({page})=>{
  test.skip(!modelB,"Set private IFC path");test.setTimeout(90000);
  await workspacePage(page);await openModel(page,modelB!);
  const source=await page.evaluate(async()=>{
    const v=(window as any).viewer;await v.selectItems((await v.model.getItemsIdsWithGeometry()).slice(0,2));
    v.interaction.restoreMeasurements([{id:8,mode:"pointToPoint",start:{...v.model.box.min},end:{...v.model.box.max},distance:v.model.box.min.distanceTo(v.model.box.max)}]);
    return v.captureViewState();
  });
  await page.getByRole("button",{name:"Section Box",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).viewer.boxZoomActive)).toBe(true);
  await page.evaluate(()=>{
    const root=window as any,v=root.viewer,clear=v.clearSelection.bind(v);
    v.clearSelection=async()=>{v.clearSelection=clear;await clear();root.creationHeld=true;await new Promise(resolve=>root.releaseCreation=resolve);};
  });
  const rect=(await page.locator(".viewer-mount canvas").boundingBox())!;
  await page.mouse.move(rect.x+rect.width*.3,rect.y+rect.height*.3);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.7);await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).creationHeld)).toBe(true);
  await page.keyboard.press("Escape");await page.evaluate(()=>(window as any).releaseCreation());
  await expect.poll(()=>page.evaluate(()=>(window as any).viewer.captureViewState())).toEqual(source);
  await expect(page.locator(".view-tabs [role=tab]")).toHaveCount(1);
  await expect(page.locator(".viewer-measurement-label")).toHaveCount(1);
  // Closing the final document also rolls back its view if the backend rejects close.
  await page.route("**/model/cancel-load",route=>route.fulfill({status:500,body:"injected close failure"}));
  await page.locator(".document-tabs .tab-close").click();
  await expect(page.locator(".viewer-empty-state-error")).toContainText("injected close failure");
  expect(await page.evaluate(()=>(window as any).viewer.captureViewState())).toEqual(source);
  await expect(page.locator(".document-tabs [role=tab]")).toHaveCount(1);
});
