import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/health", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ok: true, appVersion: "e2e" }),
  }));
  await page.goto("/");
});

test("measurement clicks preserve order and cancelled snaps cannot restore a draft", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const interactionPath = "/src/lib/viewer-interaction.ts";
    const threePath = "/node_modules/three/build/three.module.js";
    const { ViewerInteraction } = await import(interactionPath);
    const THREE = await import(threePath);
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    host.append(canvas);
    document.body.append(host);
    const pending: Array<(value: unknown) => void> = [];
    const model = { raycastWithSnapping: () => new Promise((resolve) => pending.push(resolve)) };
    let measurements: Array<{ distance: number }> = [];
    const scene = new THREE.Scene();
    const interaction = new ViewerInteraction(host, canvas, scene, new THREE.PerspectiveCamera(), {
      activeModel: () => model,
      onInvalidate: () => {},
      onMultiSelection: () => {},
      onMeasurements: (value: typeof measurements) => { measurements = value; },
    });
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    const click = () => interaction.handleClick(new MouseEvent("click", { button: 0 }));
    const hit = (x: number) => [{ point: new THREE.Vector3(x, 0, 0) }];
    interaction.setTool("measure");
    click();
    await flush();
    const cancelledFirst = interaction.cancelAction();
    pending.shift()!(hit(0));
    await flush();
    const staleFirstDraft = interaction.hasMeasurementState();

    click();
    click();
    await flush();
    const concurrentRequests = pending.length;
    pending.shift()!(hit(0));
    await flush();
    pending.shift()!(hit(3));
    await flush();
    const distance = measurements[0]?.distance;
    interaction.clearMeasurements();

    click();
    await flush();
    interaction.setTool("select");
    interaction.setTool("measure");
    pending.shift()!(hit(9));
    await flush();
    const staleToolDraft = interaction.hasMeasurementState();
    interaction.dispose();
    const resourcesRemaining = scene.children.length;
    const overlaysRemaining = host.querySelectorAll(".viewer-measurement-label,.viewer-measurement-entry").length;
    host.remove();
    return { cancelledFirst, staleFirstDraft, concurrentRequests, distance, staleToolDraft, resourcesRemaining, overlaysRemaining };
  });
  expect(result).toEqual({
    cancelledFirst: true, staleFirstDraft: false, concurrentRequests: 1,
    distance: 3, staleToolDraft: false, resourcesRemaining: 0, overlaysRemaining: 0,
  });
});

test("latest backend activation follows any in-flight upload and skips superseded requests", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const bridgePath = "/src/lib/viewer-bridge.ts";
    const apiPath = "/src/lib/api.ts";
    const contractsPath = "/src/lib/viewer-contracts.ts";
    const { ViewerBridge } = await import(bridgePath);
    const { api } = await import(apiPath);
    const { ApiError } = await import(apiPath);
    const { LoadCancelledError } = await import(contractsPath);
    const original = { ...api };
    const calls: string[] = [];
    let finishUpload!: (value: unknown) => void;
    let active = "A";
    api.activateModel = async (hash: string) => {
      calls.push(hash);
      if (hash === "A") throw new ApiError("not cached", 404);
      return { contentHashSha256: hash, loadedAt: hash };
    };
    api.uploadModel = () => new Promise((resolve) => { finishUpload = resolve; });
    api.runtime = async () => ({ hasActiveModel: true, activeModelHash: "C", hotIndexStatus: "ready", coldIndexStatus: "ready" });
    const bridge = new ViewerBridge({ onProgress: () => {} });
    const file = new File(["IFC"], "model.ifc");
    const start = (hash: string) => bridge.prepareModel(file, hash, 1, () => {
      if (active !== hash) throw new LoadCancelledError();
    });
    try {
      const a = start("A");
      for (let i = 0; i < 8; i++) await Promise.resolve();
      active = "B";
      const b = start("B");
      active = "C";
      const c = start("C");
      finishUpload({ modelHash: "A" });
      await Promise.all([a, b, c]);
      return calls;
    } finally {
      Object.assign(api, original);
      bridge.cancelFragmentRequests();
    }
  });
  expect(result).toEqual(["A", "C"]);
});

test("Chromium upload snapshots fragment bytes before transfer", async ({ page }) => {
  let payload: Buffer | null = null;
  await page.route("**/fragment-transfer-test", async (route) => {
    payload = route.request().postDataBuffer();
    await route.fulfill({ status: 200, body: "ok" });
  });
  const detachedLength = await page.evaluate(async () => {
    const bytes = new Uint8Array([3, 1, 4, 1, 5]);
    const upload = fetch("/fragment-transfer-test", { method: "POST", body: bytes });
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    await upload;
    return bytes.byteLength;
  });
  expect(detachedLength).toBe(0);
  expect(payload).toEqual(Buffer.from([3, 1, 4, 1, 5]));
});
