import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.env.IFC_BENCH_OUTPUT || path.join(root, "benchmarks/results", `large-models-${new Date().toISOString().replace(/[:.]/g, "-")}`));
const python = path.join(root, ".venv/Scripts/python.exe");
const backendPort = Number(process.env.IFC_BENCH_PORT || 8140);
const frontendPort = backendPort + 1;
const semanticTimeoutMs = Number(process.env.IFC_BENCH_SEMANTIC_TIMEOUT_MS || 20 * 60_000);
const url = `http://127.0.0.1:${frontendPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const limit = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
};
const children = [];
let browser;
let currentModel = "setup";
const phaseFile = path.join(output, "phase.json");
await mkdir(output, { recursive: true });
if (await stat(path.join(output, "resources.jsonl")).catch(() => null)) {
  throw new Error("Choose a fresh IFC_BENCH_OUTPUT directory to avoid mixing cache and resource samples from different runs");
}
const manifest = JSON.parse(await readFile(path.join(root, "benchmarks/corpus.local.json"), "utf8"));
const filter = process.env.IFC_BENCH_MODELS?.split(",");
const models = manifest.models.filter((model) => !filter || filter.includes(model.id));
const results = { startedAt: new Date().toISOString(), viewport: { width: 1440, height: 900 }, models: [] };

async function phase(name, page) {
  await writeFile(phaseFile, JSON.stringify({ model: currentModel, phase: name }));
  if (page) await limit(page.evaluate((name) => { window.__bench.phase = name; }, name), 30_000, "set phase");
}
function launch(command, args, name, env = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const log = createWriteStream(path.join(output, `${name}.log`));
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.on("error", (error) => console.error(name, error.message));
  children.push({ child, name, log });
  return child;
}
async function waitHttp(address) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(address, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch {}
    await delay(300);
  }
  throw new Error(`Server did not start: ${address}`);
}
async function resources() {
  try { return JSON.parse(await readFile(path.join(output, "resources.status.json"), "utf8")); } catch { return null; }
}
async function guard() {
  const sample = await resources();
  if (sample && Date.now() / 1000 - sample.time > 15) throw new Error("Resource monitor stopped updating; benchmark measurements are incomplete");
  if (sample && sample.availableBytes < 6 * 1024 ** 3) throw new Error("Stopped benchmark: available physical RAM below 6 GiB");
}

async function disableNetworkTelemetry(page) {
  // Playwright 1.62 has no public switch for its own CDP Network sessions.
  // An additional newCDPSession only configures that extra session. Disable the
  // existing observer after navigation so binary cache POSTs are not expanded
  // into huge DevTools strings. Application HTTP traffic continues normally.
  const implementation = page._connection?.toImpl?.(page);
  const sessions = implementation?.delegate?._networkManager?._sessions;
  if (!(sessions instanceof Map) || !sessions.size) {
    throw new Error("Playwright internals changed: cannot disable binary-body telemetry safely");
  }
  for (const { session } of sessions.values()) await session.send("Network.disable");
}

async function instrument(page) {
  await page.evaluate(async () => {
    const source = "/src/lib/viewer.ts";
    const { ViewerService } = await import(source);
    const b = window.__bench = { phase: "baseline", runs: [], frames: {}, inputFrames: {}, longTasks: {}, pendingInputs: [], selectionEvents: [], measurements: [], events: [] };
    let lastFrame = performance.now();
    const push = (map, value) => { const list = map[b.phase] ||= []; if (list.length < 120000) list.push(value); };
    function frame(now) { push(b.frames, now - lastFrame); lastFrame = now; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) push(b.longTasks, entry.duration); }).observe({ type: "longtask", buffered: false });
    for (const type of ["pointerdown", "pointermove", "wheel"]) {
      document.addEventListener(type, (event) => { if (event.target instanceof HTMLCanvasElement) b.pendingInputs.push({ phase: b.phase, at: event.timeStamp }); }, true);
    }
    const original = ViewerService.prototype.load;
    ViewerService.prototype.load = function(file) {
      window.__benchViewer = this;
      const run = { name: file.name, started: performance.now(), stages: [], bridge: [], done: false, error: null };
      b.runs.push(run); b.current = run;
      if (!this.__benchInstalled) {
        this.__benchInstalled = true;
        const callbacks = this.callbacks;
        for (const key of ["onProgress", "onBridgeProgress", "onFragmentMetrics", "onSelection", "onMeasurementChange"]) {
          const previous = callbacks[key];
          callbacks[key] = (event) => {
            const current = b.current;
            if (key === "onProgress") {
              current.sequence = event.loadSequence;
              current.progress = event;
              if (current.stages.at(-1)?.stage !== event.stage) current.stages.push({ ...event, atMs: performance.now() - current.started });
            } else if (key === "onBridgeProgress") {
              current.bridgeProgress = event;
              if (current.bridge.at(-1)?.stage !== event.stage) current.bridge.push({ ...event, atMs: performance.now() - current.started });
            } else if (key === "onFragmentMetrics") current.metrics = event;
            else if (key === "onSelection") b.selectionEvents.push({ at: performance.now(), hit: Boolean(event), globalId: event?.globalId });
            else b.measurements = event;
            previous(event);
          };
        }
        const render = this.renderer.render.bind(this.renderer);
        this.renderer.render = (...args) => {
          render(...args);
          const now = performance.now();
          const current = b.current;
          if (current && !current.firstModelRenderMs && this.activeModel?.modelId.endsWith(`-${current.sequence}`)) current.firstModelRenderMs = now - current.started;
          for (const input of b.pendingInputs.splice(0)) {
            const list = b.inputFrames[input.phase] ||= [];
            if (list.length < 120000) list.push(now - input.at);
          }
        };
      }
      return original.call(this, file).then(() => { run.done = true; run.completedMs = performance.now() - run.started; }, (error) => {
        run.done = true; run.error = String(error); run.completedMs = performance.now() - run.started; throw error;
      });
    };
  });
}

async function loadModel(page, model, kind) {
  await phase(kind, page);
  await guard();
  const oldCount = await page.evaluate(() => window.__bench.runs.length);
  await page.locator('input[type="file"]').setInputFiles(model.path);
  const started = Date.now();
  let lastLog = 0;
  while (Date.now() - started < 20 * 60_000) {
    await guard();
    const run = await limit(page.evaluate(() => ({ count: window.__bench.runs.length, current: window.__bench.current })), 45_000, "UI response during load");
    if (run.count > oldCount && run.current.done) {
      if (run.current.error) throw new Error(run.current.error);
      console.log(JSON.stringify({ model: model.id, kind, result: "loaded", seconds: run.current.completedMs / 1000 }));
      return run.current;
    }
    if (Date.now() - lastLog > 30_000) {
      const usage = await resources();
      console.log(JSON.stringify({ model: model.id, kind, elapsedSeconds: Math.round((Date.now() - started) / 1000), stage: run.current?.progress?.stage, progress: run.current?.progress?.progress, semantic: run.current?.bridgeProgress?.stage, privateGiB: usage && +(usage.privateBytes / 1024 ** 3).toFixed(2), availableGiB: usage && +(usage.availableBytes / 1024 ** 3).toFixed(2) }));
      lastLog = Date.now();
    }
    await delay(1500);
  }
  throw new Error("Model load exceeded 20 minutes");
}

async function navigation(page, name, button) {
  await phase(name, page);
  const canvas = page.locator(".viewer-mount canvas");
  const box = await canvas.boundingBox();
  const x = box.x + box.width * 0.5, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  if (button) await page.mouse.down({ button });
  for (let step = 0; step < 150; step++) {
    if (name === "zoom") { if (step % 10 === 0) await page.mouse.wheel(0, step < 75 ? -60 : 60); }
    else await page.mouse.move(x + Math.sin(step / 24) * 170, y + Math.cos(step / 24) * 60);
    await delay(16);
  }
  if (button) await page.mouse.up({ button });
  await delay(500);
}

async function snapshot(page) {
  return limit(page.evaluate(() => {
    const b = window.__bench, v = window.__benchViewer;
    const summarize = (map) => Object.fromEntries(Object.entries(map).map(([key, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const quantile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
      return [key, { samples: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), p99Ms: quantile(0.99), maxMs: sorted.at(-1) ?? null, over50Ms: sorted.filter((v) => v > 50).length }];
    }));
    return { runs: b.runs, frames: summarize(b.frames), inputToRender: summarize(b.inputFrames), longTasks: summarize(b.longTasks), selections: b.selectionEvents, measurementCount: b.measurements.length,
      renderer: v && { memory: { ...v.renderer.info.memory }, drawCalls: v.renderer.info.render.calls, triangles: v.renderer.info.render.triangles }, canvasCount: document.querySelectorAll(".viewer-mount canvas").length };
  }), 30_000, "snapshot");
}

try {
  await phase("setup");
  const backend = launch(python, ["benchmarks/serve_benchmark.py", String(backendPort), path.join(output, "backend.stop")], "backend", {
    IFC_MODEL_CACHE_DIR: path.join(output, "cache"), IFC_CACHE_KEEP_MODELS: "8", IFC_CACHE_MAX_BYTES: String(80 * 1024 ** 3),
  });
  backend.stdin.end();
  const vite = launch(process.execPath, ["frontend/node_modules/vite/bin/vite.js", "frontend", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], "vite", { IFC_BRIDGE_URL: `http://127.0.0.1:${backendPort}` });
  launch(python, ["benchmarks/windows_resource_monitor.py", String(process.pid), path.join(output, "resources.jsonl"), phaseFile], "monitor");
  await waitHttp(`http://127.0.0.1:${backendPort}/health`);
  await waitHttp(url);
  browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
  const browserSession = await browser.newBrowserCDPSession();
  results.gpu = await browserSession.send("SystemInfo.getInfo");
  results.browserVersion = browser.version();
  await writeFile(path.join(output, "environment.json"), JSON.stringify({ browserVersion: results.browserVersion, gpu: results.gpu }, null, 2));
  for (const model of models) {
    currentModel = model.id;
    const context = await browser.newContext({ viewport: results.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const entry = { id: model.id, sizeBytes: (await stat(model.path)).size, status: "running", errors: [], warnings: [] };
    results.models.push(entry);
    page.on("pageerror", (error) => entry.errors.push(String(error)));
    page.on("console", (message) => { if (["warning", "error"].includes(message.type()) && entry.warnings.length < 50) entry.warnings.push(message.text()); });
    page.on("crash", () => { entry.status = "crashed"; });
    try {
      await page.goto(url);
      await page.locator(".viewer-mount canvas").waitFor();
      await disableNetworkTelemetry(page);
      entry.networkTelemetry = "disabled after navigation";
      await instrument(page);
      const gpuRenderer = await page.evaluate(() => { const gl = document.querySelector("canvas").getContext("webgl2"); const extension = gl?.getExtension("WEBGL_debug_renderer_info"); return extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL); });
      entry.webglRenderer = gpuRenderer;
      console.log(JSON.stringify({ model: model.id, sizeBytes: entry.sizeBytes, renderer: gpuRenderer }));
      await loadModel(page, model, "cold-load");
      await navigation(page, "orbit", "left");
      await navigation(page, "pan", "right");
      await navigation(page, "zoom", null);
      await page.evaluate(() => window.__benchViewer.fit({ animate: false }));
      await delay(1500);
      await phase("select", page);
      const box = await page.locator(".viewer-mount canvas").boundingBox();
      let hitPoint = null;
      for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.5], [0.6, 0.5], [0.5, 0.4], [0.5, 0.6], [0.3, 0.4], [0.7, 0.6]]) {
        const before = await page.evaluate(() => window.__bench.selectionEvents.length);
        const at = Date.now();
        const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
        await page.mouse.click(point.x, point.y);
        for (let i = 0; i < 30; i++) {
          await delay(100);
          const event = await limit(page.evaluate(() => ({ count: window.__bench.selectionEvents.length, last: window.__bench.selectionEvents.at(-1) })), 30_000, "selection");
          if (event.count > before) {
            if (event.last.hit) { hitPoint = point; entry.selectionResponseMs = Date.now() - at; }
            break;
          }
        }
        if (hitPoint) break;
      }
      entry.selectionHit = Boolean(hitPoint);
      await phase("measure", page);
      await page.evaluate(() => { window.__benchViewer.setTool("measure"); window.__benchViewer.setMeasureMode("edge"); });
      const measurePoint = hitPoint || { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(measurePoint.x, measurePoint.y);
      await page.mouse.click(measurePoint.x, measurePoint.y);
      await delay(1500);
      entry.measurementCount = await page.evaluate(() => window.__bench.measurements.length);
      await page.evaluate(() => window.__benchViewer.setTool("pan"));
      await phase("section", page);
      await page.evaluate(() => {
        const v = window.__benchViewer, b = v.activeModel.box;
        v.setSectionPlane({ point: { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 }, normal: { x: 1, y: 0, z: 0 }, side: "positive" });
      });
      await delay(2000);
      await page.screenshot({ path: path.join(output, `${model.id}-section.png`) });
      await page.evaluate(() => window.__benchViewer.clearSectionPlane());
      entry.cold = await snapshot(page);
      await writeFile(path.join(output, `${model.id}.json`), JSON.stringify(entry, null, 2));
      await phase("semantic-wait", page);
      const semanticDeadline = Date.now() + semanticTimeoutMs;
      let nextSemanticLog = 0;
      for (; Date.now() < semanticDeadline;) {
        await guard();
        const status = await (await fetch(`http://127.0.0.1:${backendPort}/model/runtime`, { signal: AbortSignal.timeout(20_000) })).json();
        entry.runtime = status;
        const expectedHash = entry.cold.runs[0].metrics.modelHash;
        if (status.activeModelHash !== expectedHash) throw new Error("Semantic active model hash does not match loaded geometry");
        if (status.hotIndexStatus === "error" || status.coldIndexStatus === "error") throw new Error(`Semantic index error: ${JSON.stringify(status)}`);
        if (status.hotIndexStatus === "ready" && status.coldIndexStatus === "ready") break;
        if (Date.now() >= nextSemanticLog) {
          console.log(JSON.stringify({ model: model.id, phase: "semantic-wait", hot: status.hotIndexStatus, cold: status.coldIndexStatus }));
          nextSemanticLog = Date.now() + 30_000;
        }
        await delay(1000);
      }
      if (entry.runtime.coldIndexStatus !== "ready") throw new Error(`Cold index did not complete within ${semanticTimeoutMs / 60_000} minutes after tool checks`);
      const cold = await snapshot(page);
      entry.cold = cold;
      await loadModel(page, model, "warm-load");
      entry.warmCacheHit = await page.evaluate(() => window.__bench.current.metrics?.cacheHit);
      await navigation(page, "warm-orbit", "left");
      entry.final = await snapshot(page);
      await page.screenshot({ path: path.join(output, `${model.id}-loaded.png`) });
      await phase("unload", page);
      await page.evaluate(async () => { await window.__benchViewer.clearModel(); });
      const cdp = await context.newCDPSession(page);
      await cdp.send("HeapProfiler.collectGarbage");
      await delay(3000);
      entry.afterUnload = { resources: await resources(), viewer: await snapshot(page), heap: await cdp.send("Runtime.getHeapUsage") };
      entry.status = "passed";
    } catch (error) {
      entry.status = "failed"; entry.failure = String(error);
      console.log(JSON.stringify({ model: model.id, failure: entry.failure }));
      try { entry.partial = await snapshot(page); } catch {}
      try { await limit(page.screenshot({ path: path.join(output, `${model.id}-failure.png`) }), 5000, "failure screenshot"); } catch {}
    } finally {
      await writeFile(path.join(output, `${model.id}.json`), JSON.stringify(entry, null, 2));
      await writeFile(path.join(output, "summary.json"), JSON.stringify(results, null, 2));
      await context.close().catch(() => {});
      console.log(JSON.stringify({ model: model.id, status: entry.status, warmCacheHit: entry.warmCacheHit }));
    }
  }
} catch (error) {
  results.failure = String(error);
  console.error(error);
} finally {
  await phase("shutdown");
  if (browser) await browser.close().catch(() => {});
  for (const { child, name } of children.filter((value) => value.name === "backend")) {
    await writeFile(path.join(output, "backend.stop"), "stop");
    for (let i = 0; i < 40 && child.exitCode === null; i++) await delay(500);
    if (child.exitCode === null) child.kill();
  }
  for (const { child, name, log } of children) { if (name !== "backend" && child.exitCode === null) child.kill(); log.end(); }
  results.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, "summary.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ resultFile: path.join(output, "summary.json"), models: results.models.map(({ id, status }) => ({ id, status })) }));
}
