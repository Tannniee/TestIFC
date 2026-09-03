import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, process.env.IFC_SMOKE_OUTPUT || "benchmarks/results/foundation-live-2026-09-03");
await mkdir(out, { recursive: true });
const port = Number(process.env.IFC_SMOKE_PORT || 8162);
const token = randomBytes(32).toString("hex");
const stop = path.join(out, `backend-${Date.now()}.stop`);
const env = { ...process.env, IFC_API_SESSION_TOKEN: token, IFC_MODEL_CACHE_DIR: path.join(out, "cache"), IFC_BRIDGE_URL: `http://127.0.0.1:${port}` };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const backend = spawn(path.join(root, ".venv/Scripts/python.exe"), ["benchmarks/serve_benchmark.py", String(port), stop], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const backendLog = createWriteStream(path.join(out, "backend.log")); backend.stdout.pipe(backendLog); backend.stderr.pipe(backendLog);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${env.IFC_BRIDGE_URL}/health`)).ok) { ready = true; break; } } catch {} await pause(200); }
  if (!ready) throw new Error("Backend did not start");
  if ((await fetch(`${env.IFC_BRIDGE_URL}/selection`)).status !== 401) throw new Error("Anonymous API request was accepted");
  if ((await fetch(`${env.IFC_BRIDGE_URL}/selection`, { headers: { "X-IFC-Session": token } })).status !== 200) throw new Error("Authenticated API request failed");
  if ((await fetch(`${env.IFC_BRIDGE_URL}/selection`, { headers: { "X-IFC-Session": token, Origin: "https://evil.example" } })).status !== 403) throw new Error("Foreign Origin was accepted");
  const tests = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
    cwd: path.join(root, "frontend"), windowsHide: true, stdio: "inherit", env: { ...env, IFC_E2E_MODEL_PATH: process.env.IFC_E2E_MODEL_PATH || path.join(root, "benchmarks/results/watchlist-browser-cache/845122873cfe408fbf537841dcdfc17f8b1d0e365a171abc8585ef7a2861eeac.ifc") },
  });
  const code = await new Promise((resolve, reject) => { tests.once("error", reject); tests.once("exit", resolve); });
  if (code !== 0) throw new Error(`Browser suite failed: ${code}`);
} finally {
  await writeFile(stop, "stop");
  for (let i = 0; i < 100 && backend.exitCode === null; i++) await pause(200);
  if (backend.exitCode === null) { backend.kill(); throw new Error("Backend exceeded shutdown timeout"); }
  console.log(`Backend exit: ${backend.exitCode}`);
}
