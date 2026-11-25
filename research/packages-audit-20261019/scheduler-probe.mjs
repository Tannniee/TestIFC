import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { MutablePropertyView, StoreEditor } from '../../packages/mutations/dist/index.js';

const observations = [];
for (let iteration = 0; iteration < 3; iteration++) {
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor({ entityIndex: { byId: new Map() } }, view);
  const item = editor.addEntity('IfcTriangulatedFaceSet', ['#9', null, false, [[1, 2, 3]], null]).expressId;
  const next = view.peekNextExpressId();
  const values = Array.from({ length: 3000 }, (_, i) => [i / 100, -i / 100]);
  const operations = [
    { kind: 'create', expressId: next, type: 'IfcTextureVertexList', attributes: [values] },
    { kind: 'setPositionalAttribute', expressId: item, index: 2, value: true },
  ];
  const original = globalThis.setTimeout;
  const delays = [];
  let taskRan = false;
  globalThis.setTimeout = (callback, delay, ...args) => {
    const start = performance.now();
    return original(() => { if (delay === 0) delays.push(performance.now() - start); callback(...args); }, delay);
  };
  const start = performance.now();
  try {
    const preparation = editor.prepareEntityOperations(operations, { maxSliceMs: 0.01 });
    const task = original(() => { taskRan = true; }, 0);
    const prepared = await preparation;
    clearTimeout(task);
    assert.ok(taskRan);
    assert.equal(prepared.effects.length, 2);
    prepared.dispose();
    const sorted = [...delays].sort((a, b) => a - b);
    observations.push({ iteration, elapsedMs: performance.now() - start, yields: delays.length,
      p50DelayMs: sorted[Math.floor(sorted.length / 2)], p95DelayMs: sorted[Math.ceil(sorted.length * .95) - 1],
      maxDelayMs: sorted.at(-1), inputRows: values.length, hostTaskRan: taskRan });
  } finally { globalThis.setTimeout = original; }
}
await writeFile(new URL('./scheduler-probe.json', import.meta.url), JSON.stringify(observations, null, 2));
console.log(JSON.stringify(observations, null, 2));
