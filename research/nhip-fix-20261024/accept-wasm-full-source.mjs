import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertClosedMesh } from './mesh-witness.mjs';
const root = 'F:/Steel/VBA/IFC-Lite-Core104';
const wasm = await readFile(root + '/packages/wasm/pkg/ifc-lite_bg.wasm');
const sha256 = createHash('sha256').update(wasm).digest('hex');
assert.equal(sha256, process.env.EXPECT_WASM_HASH);
const mod = await import(pathToFileURL(root + '/packages/wasm/pkg/ifc-lite.js'));
mod.initSync({ module: wasm });
const source = await readFile('F:/Working/IFC Temp/Nhip chinh.ifc');
const api = new mod.IfcAPI();
const selected = new Set([434, 820, 2361, 2444, 64951, 266636, 322443, 344051, 322462,
  298390, 303995, 304217, 150461, 152785,
  178955,281338,448868,460997,490757,464047,472872,809515,817569,818684,
  824437,825013,830064,831471,831549,836117,836248,837397,842718,845196,845414,
  473164,473277,473789,473865,471627,473024,473532,257768,258582,258648,286665,
  286744,286882,286961,287038,292599,15785,89056,178623,198892,248619,10217,
  714937,618305,704523,615144,647471,679523,725690,566424,665548,625141,319371]);
let collection;
try {
  const pre = api.buildPrePassOnce(source);
  const jobs = [];
  for (let i = 0; i < pre.jobs.length; i += 3) {
    if (selected.has(pre.jobs[i])) jobs.push(...pre.jobs.subarray(i, i + 3));
  }
  collection = api.processGeometryBatch(source, Uint32Array.from(jobs), pre.unitScale,
    ...pre.rtcOffset, pre.needsShift, pre.voidKeys, pre.voidCounts, pre.voidValues,
    pre.styleIds, pre.styleColors, pre.planeAngleToRadians, pre.materialElementIds,
    pre.materialColorCounts, pre.materialColors);
  const meshes = [];
  for (let i = 0; i < collection.length; i++) {
    const m = collection.takeMesh(i);
    try { meshes.push({ id: m.expressId, type: m.ifcType, positions: Array.from(m.positions),
      indices: Array.from(m.indices), origin: Array.from(m.origin), color: Array.from(m.color) }); }
    finally { m.free(); }
  }
  const data = { sha256, preRtcIfc: Array.from(pre.rtcOffset),
    rtcYup: [collection.rtcOffsetX, collection.rtcOffsetY, collection.rtcOffsetZ],
    diagnostics: collection.diagnostics, meshes };
  await writeFile(process.env.DIAG_OUT || import.meta.dirname + '/wasm-full-selected.json', JSON.stringify(data));
  const body = meshes.find(m => m.id === 2444);
  assertClosedMesh(body);
  for (const mesh of meshes) assertClosedMesh(mesh);
  assert.equal(meshes.length, selected.size - 1);
  assert.equal(data.diagnostics.totalCsgFailures, 0);
  assert.ok(!meshes.some(m => m.id === 322462));
  console.log(JSON.stringify({ sha256, diagnostics: data.diagnostics,
    meshes: meshes.map(m => ({ id: m.id, triangles: m.indices.length / 3 })) }));
} finally {
  collection?.free();
  api.clearPrePassCache();
  api.free();
}
