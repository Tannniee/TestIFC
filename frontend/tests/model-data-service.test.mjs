import assert from "node:assert/strict";
import test from "node:test";
import { ModelDataService, buildFacetTree, descendantIds, filterBrowserTree } from "../src/lib/model-data-service.ts";

const filter = { conditions: [{ kind: "pset", setName: "Pset_Test", propertyName: "Rating", op: "eq", value: "A" }], match: "all", ifcType: "" };
function queryService(read, model = { getItemsIdsWithGeometry: async () => [1, 2, 501, 1001] }, active = () => model) {
  return new ModelDataService(active, () => "a".repeat(64), async () => {}, async () => {}, async () => {}, read);
}
const pageOf = (ids, total, nextCursor) => ({ modelHash: "a".repeat(64), coldStatus: "ready", total,
  nextCursor, truncated: nextCursor !== null, results: ids.map(localId => ({ localId, name: `Beam ${localId}`, ifcType: "IfcBeam", globalId: null })) });

test("tree visibility uses each geometry occurrence's flag", async () => {
  const model = { getItemsIdsWithGeometry: async () => [5,43,47], getVisible: async () => [true,true,false],
    getItemsByVisibility: async () => [5,43,47] };
  const service = queryService(async () => {}, model);
  assert.deepEqual(await service.getVisibleIds(true), [5,43]);
  assert.deepEqual(await service.getVisibleIds(false), [47]);
});

test("compound BIM selection collects all pages and excludes records without geometry", async () => {
  const calls = [], progress = [];
  const service = queryService(async (hash, request) => {
    calls.push(request.cursor); assert.equal(request.limit, 500);
    const ids = Array.from({ length: Math.min(500, 1101 - request.cursor) }, (_, i) => request.cursor + i + 1);
    return pageOf(ids, 1101, ids.at(-1) < 1101 ? ids.at(-1) : null);
  });
  const result = await service.searchAllSemantic(filter, (loaded, total) => progress.push([loaded, total]), () => false);
  assert.equal(result.results.length, 1101);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.selectableIds, [1, 2, 501, 1001]);
  assert.deepEqual(calls, [0, 500, 1000]);
  assert.deepEqual(progress, [[500, 1101], [1000, 1101], [1101, 1101]]);
});

test("a failed second page never produces a partial BIM selection", async () => {
  const service = queryService(async (_, request) => {
    if (request.cursor) throw new Error("network failure");
    return pageOf([1, 2], 3, 2);
  });
  await assert.rejects(service.searchAllSemantic(filter, () => {}, () => false), /network failure/);
});

test("BIM queries reject stale owners and edits while awaiting a page", async () => {
  for (const reason of ["owner", "edit", "hash"]) {
    let active = {}, cancelled = false, release;
    const service = queryService(() => new Promise(resolve => { release = resolve; }), active, () => active);
    const request = service.searchAllSemantic(filter, () => {}, () => cancelled);
    if (reason === "owner") active = {};
    if (reason === "edit") cancelled = true;
    release({ ...pageOf([1], 1, null), modelHash: (reason === "hash" ? "b" : "a").repeat(64) });
    await assert.rejects(request, /cancelled/);
  }
});

test("BIM queries reject incomplete totals and nonadvancing cursors", async () => {
  for (const page of [pageOf([1], 2, null), pageOf([1], 2, 0)]) {
    const service = queryService(async () => page);
    await assert.rejects(service.searchAllSemantic(filter, () => {}, () => false), /Incomplete|Invalid/);
  }
  const service = queryService(async (_, request) => pageOf([request.cursor + 1], request.cursor ? 3 : 2, request.cursor ? null : 1));
  await assert.rejects(service.searchAllSemantic(filter, () => {}, () => false), /result changed/);
});

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
  }, async () => { throw new Error("unused"); }, async () => { throw new Error("unused"); });
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
    () => new Promise(resolve => { release = resolve; }), async () => { throw new Error("unused"); }, async () => { throw new Error("unused"); });
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
  }, async () => { throw new Error("unused"); }, async () => { throw new Error("unused"); });
  assert.equal((await service.getProperties(5, "properties")).coldStatus, "indexing");
  assert.equal((await service.getProperties(5, "properties")).groups[0].name, "Qto_Test");
  assert.equal(calls, 2);
});

test("browser facets keep multiple system memberships and filters preserve group paths", () => {
  const tree = buildFacetTree({ modelHash: "a".repeat(64), view: "systems", coldStatus: "ready",
    elements: [
      { localId: 2, globalId: "wall-guid", ifcType: "IfcWall", name: "Wall A" },
      { localId: 3, globalId: "door-guid", ifcType: "IfcDoor", name: "Door A" },
    ],
    facets: [
      { key: "10", label: "HVAC", localId: 2 },
      { key: "11", label: "Envelope", localId: 2 },
    ],
  });
  assert.deepEqual(tree.map(node => `${node.label}:${node.count}`), ["HVAC:1", "Envelope:1", "Unassigned:1"]);
  assert.deepEqual(descendantIds(tree[0]), [2]);
  const filtered = filterBrowserTree(tree, "wall-guid", "IfcWall", "selected", new Set([2]));
  assert.deepEqual(filtered.map(node => node.label), ["HVAC", "Envelope"]);
  assert.deepEqual(filterBrowserTree(tree, "door", "", "visible", new Set([2])), []);
  assert.deepEqual(filterBrowserTree(tree, "", "", "all", null, new Set([3])).map(node => node.label), ["Unassigned"]);
});

test("spatial browser groups product categories under storey and flags uncontained geometry", async () => {
  const model = {
    getSpatialStructure: async () => ({ category: "IfcProject", localId: 1, children: [
      { category: "IfcBuildingStorey", localId: 4, children: [
        { category: "IfcWall", localId: 2 }, { category: "IfcDoor", localId: 3 },
      ] },
    ] }),
    getItemsIdsWithGeometry: async () => [2, 3, 5],
  };
  const hash = "a".repeat(64);
  const service = new ModelDataService(() => model, () => hash, async () => { throw new Error("unused"); },
    async () => ({ modelHash: hash, view: "spatial", coldStatus: "ready", facets: [], elements: [
      { localId: 2, globalId: "W2", ifcType: "IfcWall", name: "Wall A" },
      { localId: 3, globalId: "D3", ifcType: "IfcDoor", name: "Door A" },
      { localId: 5, globalId: "B5", ifcType: "IfcBeam", name: "Beam outside" },
    ] }), async () => { throw new Error("unused"); });
  const tree = await service.getTree();
  const storey = tree[0].children[0];
  assert.deepEqual(storey.children.map(node => `${node.label}:${node.count}`), ["Doors:1", "Walls:1"]);
  assert.deepEqual(descendantIds(storey).sort(), [2, 3]);
  assert.equal(tree[1].label, "Uncontained");
  assert.equal(tree[1].children[0].children[0].label, "Beam outside");
});
