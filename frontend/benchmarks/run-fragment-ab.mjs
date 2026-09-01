import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { IfcImporter } from "@thatopen/fragments";

const modelPath = process.argv[2];
if (!modelPath) throw new Error("Usage: node benchmarks/run-fragment-ab.mjs <model.ifc>");
const iterations = Math.max(1, Number.parseInt(process.argv[3] ?? "5", 10));

const source = await readFile(resolve(modelPath));
const profiles = {
  full(importer) {
    importer.addAllAttributes();
    importer.addAllRelations();
  },
  attributes(importer) {
    importer.addAllAttributes();
  },
  minimum() {},
};

const results = [];
for (const [profile, configure] of Object.entries(profiles)) {
  const samples = [];
  let fragmentBytes = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    global.gc?.();
    const importer = new IfcImporter();
    importer.wasm = {
      path: `${resolve("node_modules", "web-ifc")}${sep}`,
      absolute: true,
    };
    configure(importer);
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const fragments = await importer.process({
      bytes: new Uint8Array(source),
      raw: false,
    });
    fragmentBytes = fragments.byteLength;
    samples.push({
      milliseconds: performance.now() - started,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    });
  }
  const times = samples.map((sample) => sample.milliseconds).sort((a, b) => a - b);
  const heaps = samples.map((sample) => sample.heapDeltaBytes).sort((a, b) => a - b);
  const middle = Math.floor(samples.length / 2);
  results.push({
    profile,
    ifcBytes: source.byteLength,
    fragmentBytes,
    iterations,
    conversionMillisecondsMedian: Number(times[middle].toFixed(3)),
    conversionMillisecondsMin: Number(times[0].toFixed(3)),
    conversionMillisecondsMax: Number(times.at(-1).toFixed(3)),
    heapDeltaBytesMedian: heaps[middle],
  });
}

console.log(JSON.stringify({ schemaVersion: 1, results }, null, 2));
