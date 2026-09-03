// Read-only graphics A/B: existing real-model fragments, baseline source from Git.
// No model-cache writes, index builds, or private model data in the result JSON.
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, process.env.IFC_RENDER_OUTPUT || "benchmarks/results/render-navigation-2026-09-03");
const cache = path.resolve(root, process.env.IFC_RENDER_CACHE || "benchmarks/results/large-models-final-2026-09-02/cache");
const baselineRef = process.env.IFC_RENDER_BASELINE || "0aa9684e6dec9d3e3196a9fbc626f0b4457fcf36";
const models = await Promise.all((process.env.IFC_RENDER_MODELS || "mascot-steel,pvf-stadium").split(",").map(async id => {
  const previous = JSON.parse(await readFile(path.join(cache, "..", `${id}.json`), "utf8"));
  return { id, hash: previous.runtime.activeModelHash };
}));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const scratch = [".render-baseline.ts", ".render-baseline-camera.ts"].map(name => path.join(root, "frontend/src/lib", name));
await mkdir(output, { recursive: true });
const result = { baselineRef, viewport: { width: 1440, height: 900 }, runs: [] };
let browser, vite;
let current;
const backend = createServer((req, res) => {
  if (req.url.startsWith("/model/fragments/") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    const stream = createReadStream(path.join(cache, `${current.hash}.fragments-v2-full.frag`));
    stream.on("error", error => res.destroy(error)); stream.pipe(res);
  } else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); }
});
try {
  const baseline = execFileSync("git", ["show", `${baselineRef}:frontend/src/lib/viewer.ts`], { cwd: root, encoding: "utf8" });
  await writeFile(scratch[0], baseline.replace('from "./viewer-camera"', 'from "./.render-baseline-camera"'));
  await writeFile(scratch[1], execFileSync("git", ["show", `${baselineRef}:frontend/src/lib/viewer-camera.ts`], { cwd: root, encoding: "utf8" }));
  await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
  const frontendPort = Number(process.env.IFC_RENDER_PORT || 8171);
  const log = createWriteStream(path.join(output, "vite.log"));
  vite = spawn(process.execPath, ["frontend/node_modules/vite/bin/vite.js", "frontend", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], {
    cwd: root, windowsHide: true, env: { ...process.env, IFC_BRIDGE_URL: `http://127.0.0.1:${backend.address().port}` }, stdio: ["ignore", "pipe", "pipe"],
  });
  vite.stdout.pipe(log); vite.stderr.pipe(log);
  const url = `http://127.0.0.1:${frontendPort}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch {} await pause(200); }
  browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
  for (const model of models) {
    current = model;
    for (const variant of ["baseline", "candidate"]) {
      const context = await browser.newContext({ viewport: result.viewport });
      const page = await context.newPage();
      const run = { model: model.id, variant, errors: [] }; result.runs.push(run);
      page.on("pageerror", error => run.errors.push(String(error)));
      console.log(`Loading ${model.id} ${variant}`);
      await page.goto(url);
      await page.waitForSelector(".viewer-mount canvas");
      await page.evaluate(async variant => {
        const source = variant === "baseline" ? "/src/lib/.render-baseline.ts" : "/src/lib/viewer.ts";
        const { ViewerService } = await import(source);
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;inset:0;z-index:9999;background:#20262b";
        document.body.append(host);
        const viewer = window.__renderViewer = new ViewerService(host, new Proxy({}, { get: () => () => {} }));
        viewer.bridge.prepareModel = async () => {};
        const state = window.__renderStats = { phase: "loading", frames: {}, inputs: {}, pending: [], renders: 0 };
        let last = performance.now();
        function tick(now) { (state.frames[state.phase] ||= []).push(now - last); last = now; requestAnimationFrame(tick); }
        requestAnimationFrame(tick);
        const draw = viewer.renderer.render.bind(viewer.renderer);
        viewer.renderer.render = (...args) => {
          draw(...args); state.renders++;
          const now = performance.now();
          for (const at of state.pending.splice(0)) (state.inputs[state.phase] ||= []).push(now - at);
        };
        for (const type of ["pointermove", "wheel"]) viewer.renderer.domElement.addEventListener(type, event => state.pending.push(event.timeStamp));
        await viewer.load(new File(["graphics-only cached IFC fixture"], "benchmark.ifc"));
      }, variant);
      await pause(3500);
      run.scene = await page.evaluate(() => {
        const v = window.__renderViewer; const gl = v.renderer.getContext(); const ext = gl.getExtension("WEBGL_debug_renderer_info");
        return { triangles: v.renderer.info.render.triangles, calls: v.renderer.info.render.calls, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown" };
      });
      if (!run.scene.triangles) throw new Error("Model did not render");
      const idleStart = await page.evaluate(() => window.__renderStats.renders); await pause(1500);
      run.idleRenders = await page.evaluate(start => window.__renderStats.renders - start, idleStart);
      if (variant === "candidate" && run.idleRenders !== 0) throw new Error("Candidate did not stop rendering at rest");
      for (const phase of ["pan", "zoom"]) {
        await page.evaluate(() => window.__renderViewer.fit({ animate: false })); await pause(2000);
        await page.mouse.move(720, 450);
        await page.evaluate(phase => { window.__renderStats.phase = phase; window.__renderStats.pending = []; }, phase);
        if (phase === "pan") {
          await page.mouse.down({ button: "right" });
          for (let i = 0; i < 90; i++) { await page.mouse.move(720 + 100 * Math.sin(i / 16), 450 + 45 * Math.cos(i / 16)); await pause(16); }
          await page.mouse.up({ button: "right" });
        } else {
          for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, i < 30 ? -20 : 20); await pause(35); }
        }
        await pause(1800);
      }
      run.metrics = await page.evaluate(() => {
        const stats = window.__renderStats;
        const summarize = values => { const a = [...values].sort((a, b) => a - b); return { count: a.length, p50: a[Math.floor(a.length * .5)] ?? null, p95: a[Math.floor(a.length * .95)] ?? null }; };
        return { frames: Object.fromEntries(["pan", "zoom"].map(key => [key, summarize(stats.frames[key] || [])])), inputToRender: Object.fromEntries(["pan", "zoom"].map(key => [key, summarize(stats.inputs[key] || [])])), pixelRatioAtRest: window.__renderViewer.renderer.getPixelRatio() };
      });
      await page.screenshot({ path: path.join(output, `${model.id}-${variant}.png`) });
      await page.evaluate(() => window.__renderViewer.dispose());
      await context.close();
      console.log(JSON.stringify(run));
      await writeFile(path.join(output, "comparison.json"), JSON.stringify(result, null, 2));
    }
  }
} catch (error) { result.failure = String(error); throw error; }
finally {
  await browser?.close();
  vite?.kill();
  backend.closeAllConnections(); backend.close();
  for (const file of scratch) await unlink(file).catch(() => {});
  await writeFile(path.join(output, "comparison.json"), JSON.stringify(result, null, 2));
}
