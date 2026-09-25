import assert from "node:assert/strict";
import test from "node:test";

import { ArtifactEngineV2SemanticSource } from "../src/lib/engine-v2/artifact-semantic-source.ts";

function chunk(kind, stride, records, write) {
  const buffer = new ArrayBuffer(32 + stride * records);
  const bytes = new Uint8Array(buffer);
  bytes.set(Buffer.from("IFCV2CHK"));
  const view = new DataView(buffer);
  view.setUint16(8, 1, true); view.setUint16(10, kind, true); view.setUint32(12, 32, true);
  view.setBigUint64(16, BigInt(stride * records), true); view.setUint32(24, records, true);
  for (let index = 0; index < records; index++) write?.(view, 32 + index * stride, index);
  return buffer;
}

function fixture() {
  const values = ["project-guid", "Project", "wall-guid", "Wall A", "Exterior"];
  const encoder = new TextEncoder();
  const encoded = values.map(value => encoder.encode(value));
  const offsets = [];
  let total = 0;
  for (const value of encoded) { offsets.push([total, value.length]); total += value.length; }
  const strings = chunk(11, 1, total);
  const payload = new Uint8Array(strings, 32);
  let cursor = 0;
  for (const value of encoded) { payload.set(value, cursor); cursor += value.length; }
  const records = chunk(10, 48, 2, (view, offset, index) => {
    const writeSlice = (at, pair) => { view.setUint32(at, pair?.[0] ?? 0, true); view.setUint32(at + 4, pair?.[1] ?? 0, true); };
    view.setInt32(offset, index + 1, true);
    view.setInt32(offset + 4, index ? 1 : 0, true);
    view.setUint16(offset + 8, index, true);
    view.setUint16(offset + 10, index ? 1 : 0, true);
    writeSlice(offset + 12, offsets[index ? 2 : 0]);
    writeSlice(offset + 20, offsets[index ? 3 : 1]);
    writeSlice(offset + 28, null);
    writeSlice(offset + 36, index ? offsets[4] : null);
  });
  const deepJson = new TextEncoder().encode(JSON.stringify({
    type: { expressId: 3, ifcType: "IFCWALLTYPE", name: "Wall type" },
    material: { expressId: 4, ifcType: "IFCMATERIAL", name: "Steel" },
    properties: { Pset_WallCommon: { LoadBearing: true, id: 5 } },
    quantities: { BaseQuantities: { Length: 1.5, id: 6 } },
    classifications: [{ expressId: 7, identification: "A-1", name: "Class" }],
    units: { lengthUnit: "m", projectLengthUnitScaleToMeters: 0.001 },
  }));
  const deepValues = chunk(13, 1, deepJson.length);
  new Uint8Array(deepValues, 32).set(deepJson);
  const deepIndex = chunk(12, 24, 1, (view, offset) => {
    view.setInt32(offset, 2, true);
    view.setBigUint64(offset + 8, 0n, true);
    view.setUint32(offset + 16, deepJson.length, true);
  });
  const descriptor = (file, kind, buffer, recordCount) => ({
    file, kind, sizeBytes: buffer.byteLength, payloadBytes: buffer.byteLength - 32,
    recordCount, sha256: "a".repeat(64),
  });
  const manifest = {
    typeNames: ["IFCPROJECT", "IFCWALL"],
    semantic: { status: "complete", records: 2, parentLinks: 1, roots: 1, representedProducts: 1, stringBytes: total,
      deep: { status: "complete", records: 1, productsWithRelations: 1, relationEdges: 5,
        valueBytes: deepJson.length, maximumRecordBytes: deepJson.length } },
    chunks: [
      descriptor("semantic-records.ifcv2", 10, records, 2),
      descriptor("semantic-strings.ifcv2", 11, strings, total),
      descriptor("semantic-deep-index.ifcv2", 12, deepIndex, 1),
      descriptor("semantic-deep-values.ifcv2", 13, deepValues, deepJson.length),
    ],
  };
  return { manifest, records, strings, deepIndex, deepValues };
}

test("native semantics serve hierarchy, identity, and lazy deep relations without backend indexing", async () => {
  const data = fixture();
  let rangeCalls = 0;
  const source = new ArtifactEngineV2SemanticSource("artifact", data.manifest, {
    getManifest: async () => data.manifest,
    getChunk: async (_key, file) => file === "semantic-records.ifcv2" ? data.records
      : file === "semantic-strings.ifcv2" ? data.strings : data.deepIndex,
    getChunkRange: async (_key, file, offset, length) => {
      rangeCalls++;
      assert.equal(file, "semantic-deep-values.ifcv2");
      return data.deepValues.slice(offset, offset + length);
    },
  });
  const tree = await source.getSpatialStructure();
  assert.equal(tree.children[0].category, "Project");
  assert.equal(tree.children[0].children[0].localId, 2);
  assert.equal((await source.getItemsData([2]))[0].Name.value, "Wall A");
  assert.deepEqual(await source.getGuidsByLocalIds([2, 99]), ["wall-guid", null]);
  assert.deepEqual(await source.getLocalIdsByGuids(["project-guid", "missing"]), [1, null]);
  assert.deepEqual(await source.getItemsOfCategories([/^IFCWALL$/]), { IFCWALL: [2] });
  assert.equal(rangeCalls, 0);
  const deep = (await source.getItemsData([2], { relations: { IsDefinedBy: {} } }))[0];
  assert.equal(deep.IsTypedBy.find(item => item.Name.value === "expressId").Value.value, 3);
  assert.equal(deep.HasAssociations.find(item => item.Name.value === "name").Value.value, "Steel");
  assert.equal(deep.IsDefinedBy[0].LoadBearing.value, true);
  assert.equal(deep.Quantities[0].Length.value, 1.5);
  assert.equal(deep.Classifications[0].identification.value, "A-1");
  assert.equal(rangeCalls, 1);
  source.dispose();
});

test("deep semantic corruption and disposal abort before publishing stale properties", async () => {
  const corrupt = fixture();
  new DataView(corrupt.deepIndex).setUint32(32 + 16, corrupt.manifest.semantic.deep.maximumRecordBytes + 1, true);
  const corruptSource = new ArtifactEngineV2SemanticSource("artifact", corrupt.manifest, {
    getManifest: async () => corrupt.manifest,
    getChunk: async (_key, file) => file === "semantic-records.ifcv2" ? corrupt.records
      : file === "semantic-strings.ifcv2" ? corrupt.strings : corrupt.deepIndex,
    getChunkRange: async () => { throw new Error("corrupt index must stop before range I/O"); },
  });
  await assert.rejects(corruptSource.getItemsData([2], { relations: { IsDefinedBy: {} } }), /index is invalid/);
  corruptSource.dispose();

  const data = fixture();
  const source = new ArtifactEngineV2SemanticSource("artifact", data.manifest, {
    getManifest: async () => data.manifest,
    getChunk: async (_key, file) => file === "semantic-records.ifcv2" ? data.records
      : file === "semantic-strings.ifcv2" ? data.strings : data.deepIndex,
    getChunkRange: async (_key, _file, _offset, _length, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  const pending = source.getItemsData([2], { relations: { IsDefinedBy: {} } });
  await new Promise(resolve => setTimeout(resolve, 0));
  source.dispose();
  await assert.rejects(pending, /disposed|abort/i);
});
