import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { EngineV2BinaryTables } from "../src/lib/engine-v2/binary-tables.ts";
import { EngineV2PlannerCore } from "../src/lib/engine-v2/planner-core.ts";
import { selectEngineV2Pages } from "../src/lib/engine-v2/page-selector.ts";
import { EngineV2PageRenderer } from "../src/lib/engine-v2/page-renderer.ts";

function chunk(kind, stride, count, write) {
  const buffer = new ArrayBuffer(32 + stride * count);
  const bytes = new Uint8Array(buffer);
  bytes.set(Buffer.from("IFCV2CHK"));
  const view = new DataView(buffer);
  view.setUint16(8, 1, true); view.setUint16(10, kind, true); view.setUint32(12, 32, true);
  view.setBigUint64(16, BigInt(stride * count), true); view.setUint32(24, count, true);
  for (let index = 0; index < count; index++) write?.(view, 32 + index * stride, index);
  return buffer;
}

function fixture() {
  const source = 100_000_000;
  const points = [[source, source, 0], [source + 1, source, 0], [source, source + 1, 0], [source + 1, source + 1, 0]];
  const positions = chunk(9, 32, 4, (view, offset, index) => {
    view.setInt32(offset, index + 1, true);
    points[index].forEach((value, component) => view.setFloat64(offset + 8 + component * 8, value, true));
  });
  const meshes = chunk(2, 56, 1, (view, offset) => {
    view.setInt32(offset, 10, true); view.setInt32(offset + 4, 100, true); view.setBigUint64(offset + 8, 0n, true);
    view.setInt32(offset + 16, 6, true); view.setInt32(offset + 20, 2, true); view.setInt32(offset + 24, 2, true);
    [source, source, 0, source + 1, source + 1, 0].forEach((value, index) => view.setFloat32(offset + 32 + index * 4, value, true));
  });
  const indexValues = [0, 1, 2, 1, 3, 2];
  const indices = chunk(3, 4, 6, (view, offset, index) => view.setUint32(offset, indexValues[index], true));
  const instances = chunk(4, 112, 2, (view, offset, index) => {
    view.setInt32(offset, index ? 200 : 100, true); view.setInt32(offset + 4, 10, true); view.setInt32(offset + 8, 10, true);
    const matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, index * 1000, 0, 0];
    matrix.forEach((value, component) => view.setFloat64(offset + 16 + component * 8, value, true));
  });
  const products = chunk(5, 24, 2, (view, offset, index) => {
    view.setInt32(offset, index ? 200 : 100, true); view.setInt32(offset + 4, index + 20, true);
    view.setBigUint64(offset + 8, BigInt(index), true); view.setInt32(offset + 16, 1, true); view.setUint16(offset + 20, index + 5, true);
  });
  const materials = chunk(6, 32, 2, (view, offset, index) => {
    view.setUint32(offset, index, true); view.setUint32(offset + 12, index ? 2 : 0, true);
    const rgba = index ? [0.1, 0.2, 0.9, 0.5] : [0.8, 0.1, 0.1, 1];
    rgba.forEach((value, component) => view.setFloat32(offset + 16 + component * 4, value, true));
  });
  const instanceMaterials = chunk(7, 4, 2, (view, offset, index) => view.setUint32(offset, index, true));
  const normals = chunk(8, 4, 2, (view, offset) => { view.setInt16(offset, 0, true); view.setInt16(offset + 2, 0, true); });
  const manifest = {
    cartesianPoints: 4, baseDefinitions: 1, products: 2, instances: 2, triangles: 2, expandedTriangles: 4, indices: 6,
    materials: { materialDefinitions: 2 },
    lengthUnitScaleToMetres: 1,
    sourceToViewerTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
  return { manifest, chunks: {
    "meshes.ifcv2": meshes, "indices.ifcv2": indices, "instances.ifcv2": instances,
    "products.ifcv2": products, "materials.ifcv2": materials, "instance-materials.ifcv2": instanceMaterials,
    "normals.ifcv2": normals, "positions-f64.ifcv2": positions,
  } };
}

function collapsedTriangleFixture() {
  const points = [
    [-1.60071067512035e-7, 40, 6500.1982421875],
    [-20.000000068947, 40, 6550.19824215978],
    [-21.529426292982, 40, 6554.02180773517],
  ];
  const positions = chunk(9, 32, 3, (view, offset, index) => {
    view.setInt32(offset, index + 1, true);
    points[index].forEach((value, component) => view.setFloat64(offset + 8 + component * 8, value, true));
  });
  const bounds = [
    Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1])), Math.min(...points.map(point => point[2])),
    Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1])), Math.max(...points.map(point => point[2])),
  ];
  const meshes = chunk(2, 56, 1, (view, offset) => {
    view.setInt32(offset, 1, true); view.setInt32(offset + 4, 7, true); view.setBigUint64(offset + 8, 0n, true);
    view.setInt32(offset + 16, 3, true); view.setInt32(offset + 20, 1, true); view.setInt32(offset + 24, 1, true);
    bounds.forEach((value, index) => view.setFloat32(offset + 32 + index * 4, value, true));
  });
  const instances = chunk(4, 112, 1, (view, offset) => {
    view.setInt32(offset, 7, true); view.setInt32(offset + 4, 1, true); view.setInt32(offset + 8, 1, true);
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0].forEach((value, component) => view.setFloat64(offset + 16 + component * 8, value, true));
  });
  const products = chunk(5, 24, 1, (view, offset) => {
    view.setInt32(offset, 7, true); view.setInt32(offset + 4, 8, true); view.setBigUint64(offset + 8, 0n, true);
    view.setInt32(offset + 16, 1, true); view.setUint16(offset + 20, 5, true);
  });
  const materials = chunk(6, 32, 1, (view, offset) => {
    view.setUint32(offset, 0, true); view.setFloat32(offset + 16, 1, true); view.setFloat32(offset + 20, 1, true);
    view.setFloat32(offset + 24, 1, true); view.setFloat32(offset + 28, 1, true);
  });
  const manifest = {
    cartesianPoints: 3, baseDefinitions: 1, products: 1, instances: 1, triangles: 1, expandedTriangles: 1, indices: 3,
    materials: { materialDefinitions: 1 }, lengthUnitScaleToMetres: 1,
    sourceToViewerTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
  return { manifest, chunks: {
    "meshes.ifcv2": meshes,
    "indices.ifcv2": chunk(3, 4, 3, (view, offset, index) => view.setUint32(offset, index, true)),
    "instances.ifcv2": instances,
    "products.ifcv2": products,
    "materials.ifcv2": materials,
    "instance-materials.ifcv2": chunk(7, 4, 1, (view, offset) => view.setUint32(offset, 0, true)),
    "normals.ifcv2": chunk(8, 4, 1, (view, offset) => { view.setInt16(offset, 0, true); view.setInt16(offset + 2, 0, true); }),
    "positions-f64.ifcv2": positions,
  } };
}

test("planner pages expanded instances and preserves large-coordinate triangles through local rebasing", async () => {
  const planner = new EngineV2PlannerCore(new EngineV2BinaryTables(fixture()), {
    pageSizeMetres: 100,
    maximumPageTriangles: 2,
    maximumClusterSpanMetres: 10,
    maximumClusterTriangles: 32,
    yieldEvery: 1,
  });
  const ready = await planner.initialize();
  assert.equal(ready.baseTriangles, 2);
  assert.equal(ready.expandedTriangles, 4);
  assert.equal(ready.pages.length, 2);
  assert.deepEqual(Array.from(ready.productIds), [100, 200]);
  assert.deepEqual(Array.from(ready.productMaterialOrdinals), [0, 1]);
  const page = await planner.buildPage(ready.pages[0].id);
  assert.equal(page.sourceTriangles, 2);
  assert.equal(page.nonRasterizableTriangles, 0);
  assert.equal(page.rasterizedTriangles, 2);
  assert.ok(page.clusters.length >= 1);
  assert.ok(Math.max(...page.clusters[0].positions.map(Math.abs)) <= 1);
  assert.ok(page.clusters[0].normals[2] > 0.999);
});

test("planner cancellation interrupts before page publication", async () => {
  const planner = new EngineV2PlannerCore(new EngineV2BinaryTables(fixture()), { yieldEvery: 1 }, {
    cancelled: () => true,
    yieldControl: async () => {},
  });
  await assert.rejects(() => planner.initialize(), error => error?.name === "AbortError");
});

test("planner reuses bounded base geometry across pages without sharing transferable buffers", async () => {
  const planner = new EngineV2PlannerCore(new EngineV2BinaryTables(fixture()), {
    pageSizeMetres: 100, maximumPageTriangles: 2, yieldEvery: 1,
  });
  const ready = await planner.initialize();
  let materializations = 0;
  const original = planner.materializeRange.bind(planner);
  planner.materializeRange = async (...args) => { materializations++; return original(...args); };
  const first = await planner.buildPage(ready.pages[0].id);
  const second = await planner.buildPage(ready.pages[1].id);
  assert.equal(materializations, 1);
  assert.notEqual(first.clusters[0].positions.buffer, second.clusters[0].positions.buffer);
  const expected = second.clusters[0].positions[0];
  first.clusters[0].positions[0] = expected + 100;
  const again = await planner.buildPage(ready.pages[0].id);
  assert.equal(again.clusters[0].positions[0], expected);
});

test("planner ledger rejects a triangle that only gains area from cluster rounding", async () => {
  const planner = new EngineV2PlannerCore(new EngineV2BinaryTables(collapsedTriangleFixture()));
  const ready = await planner.initialize();
  const page = await planner.buildPage(ready.pages[0].id);
  assert.equal(page.sourceTriangles, 1);
  assert.equal(page.rasterizedTriangles, 0);
  assert.equal(page.sourceDegenerateTriangles, 0);
  assert.equal(page.nonRasterizableTriangles, 1);
});

test("camera page selection obeys frustum, triangle, page, and GPU estimates", () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const pages = [
    { id: "near", bounds: [-1, -1, -1, 1, 1, 1], instances: 1, triangles: 100 },
    { id: "also-near", bounds: [2, -1, -1, 4, 1, 1], instances: 1, triangles: 100 },
    { id: "outside", bounds: [100, -1, -1, 102, 1, 1], instances: 1, triangles: 1 },
  ];
  const selected = selectEngineV2Pages(pages, camera, new Set(), {
    visibleTriangles: 100, maximumPages: 1, estimatedGpuBytes: 10_000,
    bytesPerExpandedTriangle: 1, bytesPerInstance: 1,
  });
  assert.deepEqual(selected, ["near"]);
});

test("small multi-page models remain complete at overview while dense models retain the page cap", () => {
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
  camera.position.set(0, 0, 100); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const pages = Array.from({ length: 20 }, (_, index) => ({
    id: String(index), bounds: [index, -1, -1, index + 1, 1, 1], instances: 10, triangles: 100,
  }));
  const budget = {
    visibleTriangles: 4_000_000, maximumPages: 12, overviewMaximumPages: 96,
    overviewMaximumTriangles: 1_000_000, estimatedGpuBytes: 512 * 1024 * 1024,
    bytesPerExpandedTriangle: 28, bytesPerInstance: 80,
  };
  assert.equal(selectEngineV2Pages(pages, camera, new Set(), budget).length, 20);
  assert.equal(selectEngineV2Pages(pages.map(page => ({ ...page, triangles: 100_000 })), camera, new Set(), budget).length, 12);
});

function rendererFixture() {
  const manifest = { sourceToViewerTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  const plan = {
    pages: [{ id: "page", bounds: [-1, -1, -1, 4, 1, 1], instances: 2, triangles: 2 }],
    modelBounds: [-1, -1, -1, 4, 1, 1],
    materials: [
      { ordinal: 0, flags: 0, rgba: [0.8, 0.1, 0.1, 1] },
      { ordinal: 1, flags: 2, rgba: [0.1, 0.2, 0.9, 0.5] },
    ],
    productIds: new Int32Array([7, 8]),
    productTypeIds: new Uint16Array([5, 5]),
    productMaterialOrdinals: new Uint32Array([0, 1]),
    productBounds: new Float64Array([-1, -1, 0, 1, 1, 0, 2, -1, 0, 4, 1, 0]),
    baseTriangles: 1,
    expandedTriangles: 2,
  };
  const payload = {
    pageId: "page",
    clusters: [{
      baseId: 1, clusterId: 0, origin: [0, 0, 0],
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      sourceTriangles: 1, rasterizedTriangles: 1, sourceDegenerateTriangles: 0, nonRasterizableTriangles: 0,
    }],
    instances: [{
      ordinal: 0, productId: 7, baseId: 1, materialOrdinal: 0,
      matrix: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      bounds: [-1, -1, 0, 1, 1, 0],
    }, {
      ordinal: 1, productId: 8, baseId: 1, materialOrdinal: 1,
      matrix: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 3, 0, 0]),
      bounds: [2, -1, 0, 4, 1, 0],
    }],
    sourceTriangles: 2, rasterizedTriangles: 2, sourceDegenerateTriangles: 0, nonRasterizableTriangles: 0,
  };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return { manifest, plan, payload, camera };
}

test("page renderer uploads, selects, styles, hides, and disposes a fixture page", async () => {
  const { manifest, plan, payload, camera } = rendererFixture();
  const renderer = new EngineV2PageRenderer({ buildPage: async () => payload }, manifest, plan, {
    frameUploadMilliseconds: Infinity,
  });
  await renderer.update(camera);
  assert.equal(renderer.object.children.length, 1);
  assert.deepEqual(renderer.diagnostics, {
    sourceTriangles: 2, rasterizedTriangles: 2, sourceDegenerateTriangles: 0, nonRasterizableTriangles: 0,
  });
  assert.equal(renderer.object.children[0].children.length, 2);
  assert.ok(renderer.object.children[0].children.some(batch => batch.material.transparent));
  const batch = renderer.object.children[0].children.find(batch => !batch.material.transparent);
  const source = plan.materials[0].rgba;
  const linear = new THREE.Color().setRGB(source[0], source[1], source[2], THREE.SRGBColorSpace);
  const expectedOriginal = Array.from(new Float32Array([linear.r, linear.g, linear.b, source[3]]));
  assert.deepEqual(batch.getColorAt(0, new THREE.Vector4()).toArray(), expectedOriginal);
  const transparentBatch = renderer.object.children[0].children.find(batch => batch.material.transparent);
  const transparentSource = plan.materials[1].rgba;
  const transparentLinear = new THREE.Color().setRGB(...transparentSource.slice(0, 3), THREE.SRGBColorSpace);
  assert.deepEqual(transparentBatch.getColorAt(0, new THREE.Vector4()).toArray(),
    Array.from(new Float32Array([transparentLinear.r, transparentLinear.g, transparentLinear.b, transparentSource[3]])));
  renderer.highlight([7], new THREE.Vector4(0.2, 0.3, 0.4, 0.5));
  assert.deepEqual(batch.getColorAt(0, new THREE.Vector4()).toArray(), Array.from(new Float32Array([0.2, 0.3, 0.4, 0.5])));
  renderer.resetHighlight([7]);
  assert.deepEqual(batch.getColorAt(0, new THREE.Vector4()).toArray(), expectedOriginal);
  renderer.setVisible([7], false);
  assert.equal(batch.getVisibleAt(0), false);
  renderer.setVisible([7], true);
  renderer.object.updateMatrixWorld(true);
  const hit = renderer.raycast({
    camera,
    mouse: new THREE.Vector2(50, 50),
    dom: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
  });
  assert.equal(hit?.productId, 7);
  assert.deepEqual(hit?.triangle?.map(point => point.toArray()), [[-1, -1, 0], [1, -1, 0], [0, 1, 0]]);
  renderer.dispose();
  assert.equal(renderer.object.children.length, 0);
  assert.deepEqual(renderer.diagnostics, {
    sourceTriangles: 0, rasterizedTriangles: 0, sourceDegenerateTriangles: 0, nonRasterizableTriangles: 0,
  });
});

test("dense overview represents every product while exact pages stay budgeted", () => {
  const { manifest, plan } = rendererFixture();
  plan.pages.push({ id: "other", bounds: [2, -1, -1, 4, 1, 1], instances: 1, triangles: 2 });
  plan.expandedTriangles = 4;
  const renderer = new EngineV2PageRenderer({ buildPage: async () => { throw Error("unused"); } }, manifest, plan, {
    visibleTriangles: 1, maximumPages: 1,
  });
  const overview = renderer.object.children.find(child => child.name === "Engine V2 complete model overview");
  assert.ok(overview);
  assert.equal(overview.geometry.getAttribute("position").count, plan.productIds.length * 2);
  assert.equal(overview.geometry.getAttribute("color").itemSize, 4);
  const expectedColour = new THREE.Color().setRGB(0.8, 0.1, 0.1, THREE.SRGBColorSpace);
  assert.deepEqual(Array.from(overview.geometry.getAttribute("color").array.slice(0, 3)),
    Array.from(new Float32Array([expectedColour.r, expectedColour.g, expectedColour.b])));
  assert.equal(overview.raycast(new THREE.Raycaster(), []), undefined);
  renderer.setVisible([7], false);
  assert.equal(overview.geometry.getAttribute("color").array[3], 0);
  assert.equal(overview.geometry.getAttribute("color").array[7], 0);
  renderer.setVisible([7], true);
  renderer.highlight([8], new THREE.Vector4(1, 0, 0, 1));
  assert.deepEqual(Array.from(overview.geometry.getAttribute("color").array.slice(8, 12)),
    Array.from(new Float32Array([1, 0, 0, 0.9])));
  renderer.dispose();
  assert.equal(renderer.object.children.length, 0);
});

test("dense overview dims loaded products and restores unloaded products", async () => {
  const { manifest, plan, payload, camera } = rendererFixture();
  plan.pages.push({ id: "other", bounds: [20, -1, -1, 22, 1, 1], instances: 1, triangles: 2 });
  plan.expandedTriangles = 4;
  const renderer = new EngineV2PageRenderer({ buildPage: async () => payload }, manifest, plan, {
    visibleTriangles: 1, maximumPages: 1, frameUploadMilliseconds: Infinity,
  });
  const overview = renderer.object.children[0];
  const alpha = () => overview.geometry.getAttribute("color").array[3];
  assert.equal(alpha(), new Float32Array([0.45])[0]);
  await renderer.update(camera);
  assert.equal(alpha(), new Float32Array([0.08])[0]);
  camera.position.set(1000, 0, 5); camera.lookAt(1000, 0, 0); camera.updateMatrixWorld();
  await renderer.update(camera);
  assert.equal(alpha(), new Float32Array([0.45])[0]);
  renderer.dispose();
});

test("page renderer aborts obsolete camera work", async () => {
  const { manifest, plan, camera } = rendererFixture();
  let workerSignal;
  const renderer = new EngineV2PageRenderer({
    buildPage: (_pageId, signal) => new Promise((_resolve, reject) => {
      workerSignal = signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  }, manifest, plan, { frameUploadMilliseconds: Infinity });
  const pending = renderer.update(camera);
  renderer.cancelUpdate();
  await assert.rejects(pending, error => error?.name === "AbortError");
  assert.equal(workerSignal.aborted, true);
  assert.equal(renderer.object.children.length, 0);
  renderer.dispose();
});
