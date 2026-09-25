import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { EngineV2BinaryTables } from "../frontend/src/lib/engine-v2/binary-tables.ts";
import { EngineV2PlannerCore } from "../frontend/src/lib/engine-v2/planner-core.ts";
import { ENGINE_V2_RENDER_CHUNKS } from "../frontend/src/lib/engine-v2/artifact-reader.ts";

const directory = process.argv[2];
if (!directory) {
  process.stderr.write("Usage: node --experimental-strip-types prototype_pages.mjs <artifact-chunks-directory>\n");
  process.exitCode = 2;
} else {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const chunks = {};
  const readStart = performance.now();
  for (const filename of ENGINE_V2_RENDER_CHUNKS) {
    const bytes = await readFile(join(directory, filename));
    chunks[filename] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const readMilliseconds = performance.now() - readStart;
  const planner = new EngineV2PlannerCore(new EngineV2BinaryTables({ manifest, chunks }));
  const before = process.memoryUsage();
  const start = performance.now();
  const ready = await planner.initialize();
  const initializeMilliseconds = performance.now() - start;
  const after = process.memoryUsage();
  const estimatedNativeDirectoryBytes = ready.pages.length * 64 + manifest.instances * 4 + manifest.products * 48;
  process.stdout.write(`${JSON.stringify({
    sourceSha256: manifest.sourceSha256,
    products: manifest.products,
    instances: manifest.instances,
    pages: ready.pages.length,
    baseTriangles: ready.baseTriangles,
    expandedTriangles: ready.expandedTriangles,
    readMilliseconds,
    initializeMilliseconds,
    additionalHeapBytes: after.heapUsed - before.heapUsed,
    estimatedNativeDirectoryBytes,
  })}\n`);
}
