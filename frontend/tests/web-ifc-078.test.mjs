import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { IfcAPI } from "web-ifc";

test("web-ifc 0.0.78 StreamMeshes adapter matches its three-argument WASM binding", () => {
  const api = new IfcAPI();
  const calls = [];
  api.wasmModule = { StreamMeshes: (...args) => calls.push(args) };
  const callback = () => {};
  api.StreamMeshes(1, [42], callback);
  assert.deepEqual(calls, [[1, [42], callback]]);
  assert.throws(
    () => api.StreamMeshes(1, [42], callback, false),
    /cannot disable linear scaling/,
  );
});

test("packaged WebIFC WASM files match the installed 0.0.78 package", async () => {
  for (const name of ["web-ifc.wasm", "web-ifc-mt.wasm"]) {
    const expected = await readFile(new URL(`../node_modules/web-ifc/${name}`, import.meta.url));
    const packaged = await readFile(new URL(`../public/vendor/web-ifc/${name}`, import.meta.url));
    assert.deepEqual(packaged, expected, name);
  }
});
