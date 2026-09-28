import assert from "node:assert/strict";
import test from "node:test";
import { ModelDataService } from "../src/lib/model-data-service.ts";

test("BIM data retries while the cold index is building and caches a ready record", async () => {
  const model = {};
  const hash = "a".repeat(64);
  let calls = 0;
  const service = new ModelDataService(() => model, () => hash, async (expressId, modelHash) => {
    assert.equal(expressId, 42);
    assert.equal(modelHash, hash);
    calls++;
    return calls === 1
      ? { modelHash: hash, coldStatus: "indexing", element: { expressId: 42 } }
      : { modelHash: hash, coldStatus: "ready", element: { properties: { Pset_Test: { Rating: "A" } } } };
  });
  assert.equal((await service.getProperties(42, "properties")).coldStatus, "indexing");
  const ready = await service.getProperties(42, "properties");
  assert.deepEqual(ready.groups, [{ name: "Pset_Test", rows: [{ name: "Rating", value: "A" }] }]);
  assert.deepEqual(await service.getProperties(42, "properties"), ready);
  assert.equal(calls, 2);
});

test("a BIM reply from a previous model cannot populate the current Properties panel", async () => {
  const oldModel = {}, newModel = {};
  let active = oldModel;
  let release;
  const service = new ModelDataService(() => active, () => "a".repeat(64),
    () => new Promise(resolve => { release = resolve; }));
  const pending = service.getProperties(7, "properties");
  active = newModel;
  release({ modelHash: "a".repeat(64), coldStatus: "ready", element: { properties: { Old: { Value: 1 } } } });
  await assert.rejects(pending, /Model query cancelled/);
});

test("BIM queries can retry a backend index_preparing response", async () => {
  const model = {};
  let calls = 0;
  const hash = "b".repeat(64);
  const service = new ModelDataService(() => model, () => hash, async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("index_preparing"), { status: 409 });
    return { modelHash: hash, coldStatus: "ready", element: { quantities: { Qto_Test: { NetVolume: 0 } } } };
  });
  assert.equal((await service.getProperties(5, "properties")).coldStatus, "indexing");
  assert.equal((await service.getProperties(5, "properties")).groups[0].name, "Qto_Test");
  assert.equal(calls, 2);
});
