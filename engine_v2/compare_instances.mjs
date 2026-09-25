import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IfcAPI } from "../frontend/node_modules/web-ifc/web-ifc-api-node.js";

const [sourceArgument, artifactArgument] = process.argv.slice(2);
const exact = process.argv.includes("--exact");
if (!sourceArgument || !artifactArgument) {
  console.error("Usage: node engine_v2/compare_instances.mjs <model.ifc> <chunk-directory> [--exact]");
  process.exit(2);
}

const sourcePath = path.resolve(sourceArgument);
const artifactDirectory = path.resolve(artifactArgument);
const manifest = JSON.parse(fs.readFileSync(path.join(artifactDirectory, "manifest.json"), "utf8"));
const source = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash("sha256").update(source).digest("hex").toUpperCase();
if (sourceSha256 !== manifest.sourceSha256) throw new Error("Source SHA-256 does not match the artifact.");
const booleanOperands = new Map();
const boundedHalfSpaces = new Set();
const unboundedHalfSpaces = new Set();
if (exact) {
  const step = source.toString("latin1");
  for (const match of step.matchAll(/#(\d+)=IFCBOOLEAN(?:CLIPPING)?RESULT\(\.DIFFERENCE\.,#(\d+),#(\d+)\);/g))
    booleanOperands.set(Number(match[1]), [Number(match[2]), Number(match[3])]);
  for (const match of step.matchAll(/#(\d+)=IFCPOLYGONALBOUNDEDHALFSPACE\(/g)) boundedHalfSpaces.add(Number(match[1]));
  for (const match of step.matchAll(/#(\d+)=IFCHALFSPACESOLID\(/g)) unboundedHalfSpaces.add(Number(match[1]));
}

for (const chunk of manifest.chunks) {
  const bytes = fs.readFileSync(path.join(artifactDirectory, chunk.file));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (sha256 !== chunk.sha256) throw new Error(`Chunk checksum mismatch: ${chunk.file}`);
}

const meshes = new Map();
const meshBytes = fs.readFileSync(path.join(artifactDirectory, "meshes.ifcv2"));
const indexBytes = exact ? fs.readFileSync(path.join(artifactDirectory, "indices.ifcv2")) : null;
const positionBytes = exact ? fs.readFileSync(path.join(artifactDirectory, "positions-f64.ifcv2")) : null;
for (let offset = 32; offset < meshBytes.length; offset += 56) {
  const baseId = meshBytes.readInt32LE(offset);
  meshes.set(baseId, {
    firstIndex: Number(meshBytes.readBigInt64LE(offset + 8)),
    triangles: meshBytes.readInt32LE(offset + 16) / 3,
    bounds: Array.from({ length: 6 }, (_, index) => meshBytes.readFloatLE(offset + 32 + index * 4)),
  });
}

const products = new Map();
const productBytes = fs.readFileSync(path.join(artifactDirectory, "products.ifcv2"));
for (let offset = 32; offset < productBytes.length; offset += 24) {
  products.set(productBytes.readInt32LE(offset), {
    firstInstance: Number(productBytes.readBigInt64LE(offset + 8)),
    instanceCount: productBytes.readInt32LE(offset + 16),
  });
}

const instanceBytes = fs.readFileSync(path.join(artifactDirectory, "instances.ifcv2"));
const sourceToViewer = manifest.sourceToViewerTransform;
const webGeometry = new Map();
const mismatches = [];
let mismatchCount = 0;
let comparedProducts = 0;
let comparedInstances = 0;
let maximumBoundDelta = 0;
let triangleDifference = 0;
let maximumExactBoundDelta = 0;
let exactOverOneMillimetre = 0;
let exactOverOneCentimetre = 0;
let exactOverTenCentimetres = 0;
const largestExactBoundDeltas = [];
const exactByBooleanFamily = {};

const api = new IfcAPI();
await api.Init();
const modelId = api.OpenModel(source, { COORDINATE_TO_ORIGIN: false });
try {
  api.StreamAllMeshes(modelId, (flatMesh) => {
    comparedProducts++;
    const range = products.get(flatMesh.expressID);
    if (!range) {
      addMismatch({ productExpressId: flatMesh.expressID, reason: "missing-product" });
      return;
    }
    if (range.instanceCount !== flatMesh.geometries.size()) {
      addMismatch({
        productExpressId: flatMesh.expressID,
        reason: "instance-count",
        p2: range.instanceCount,
        webIfc: flatMesh.geometries.size(),
      });
      return;
    }
    for (let index = 0; index < range.instanceCount; index++) {
      const placed = flatMesh.geometries.get(index);
      const instanceOffset = 32 + (range.firstInstance + index) * 112;
      const productId = instanceBytes.readInt32LE(instanceOffset);
      const baseId = instanceBytes.readInt32LE(instanceOffset + 4);
      const mesh = meshes.get(baseId);
      if (productId !== flatMesh.expressID || !mesh) {
        addMismatch({ productExpressId: flatMesh.expressID, index, baseId, reason: "invalid-instance-reference" });
        continue;
      }
      const sourceTransform = readAffine3X4(instanceBytes, instanceOffset + 16);
      const p2Transform = multiply4X4(sourceToViewer, sourceTransform);
      const p2Bounds = transformBounds(mesh.bounds, p2Transform);

      let fallback = webGeometry.get(placed.geometryExpressID);
      if (!fallback) {
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let vertex = 0; vertex < vertices.length; vertex += 6) {
          bounds[0] = Math.min(bounds[0], vertices[vertex]);
          bounds[1] = Math.min(bounds[1], vertices[vertex + 1]);
          bounds[2] = Math.min(bounds[2], vertices[vertex + 2]);
          bounds[3] = Math.max(bounds[3], vertices[vertex]);
          bounds[4] = Math.max(bounds[4], vertices[vertex + 1]);
          bounds[5] = Math.max(bounds[5], vertices[vertex + 2]);
        }
        fallback = { bounds, triangles: geometry.GetIndexDataSize() / 3,
          vertices: exact ? Float32Array.from(vertices) : null };
        webGeometry.set(placed.geometryExpressID, fallback);
        geometry.delete();
      }
      const webTransform = Array.from(placed.flatTransformation);
      const webBounds = transformBounds(fallback.bounds, webTransform);
      const delta = Math.max(...p2Bounds.map((value, boundIndex) => Math.abs(value - webBounds[boundIndex])));
      maximumBoundDelta = Math.max(maximumBoundDelta, delta);
      triangleDifference += mesh.triangles - fallback.triangles;
      let exactBoundDelta;
      let nativeExactWorldBounds;
      let webExactWorldBounds;
      if (exact) {
        nativeExactWorldBounds = nativeWorldBounds(mesh, p2Transform);
        webExactWorldBounds = webWorldBounds(fallback.vertices, webTransform);
        exactBoundDelta = Math.max(...nativeExactWorldBounds.map((value, boundIndex) =>
          Math.abs(value - webExactWorldBounds[boundIndex])));
        maximumExactBoundDelta = Math.max(maximumExactBoundDelta, exactBoundDelta);
        if (exactBoundDelta > 0.001) exactOverOneMillimetre++;
        if (exactBoundDelta > 0.01) exactOverOneCentimetre++;
        if (exactBoundDelta > 0.1) exactOverTenCentimetres++;
        const operands = booleanOperands.get(baseId);
        if (operands) {
          const family = booleanOperands.has(operands[0]) ? "nested" :
            boundedHalfSpaces.has(operands[1]) ? "single-bounded-halfspace" :
            unboundedHalfSpaces.has(operands[1]) ? "single-unbounded-halfspace" : "solid-or-other";
          const bucket = exactByBooleanFamily[family] ??= { instances: 0, maximumExactBoundDelta: 0,
            overOneMillimetre: 0, overOneCentimetre: 0, overTenCentimetres: 0 };
          bucket.instances++;
          bucket.maximumExactBoundDelta = Math.max(bucket.maximumExactBoundDelta, exactBoundDelta);
          if (exactBoundDelta > 0.001) bucket.overOneMillimetre++;
          if (exactBoundDelta > 0.01) bucket.overOneCentimetre++;
          if (exactBoundDelta > 0.1) bucket.overTenCentimetres++;
        }
        if (exactBoundDelta > 0.01) largestExactBoundDeltas.push({
          productExpressId: flatMesh.expressID, baseId,
          webIfcGeometryExpressId: placed.geometryExpressID, exactBoundDelta,
          nativeExactWorldBounds, webExactWorldBounds,
        });
      }
      if (delta > 1e-4 || mesh.triangles !== fallback.triangles) {
        const mismatch = {
          productExpressId: flatMesh.expressID,
          index,
          baseId,
          webIfcGeometryExpressId: placed.geometryExpressID,
          boundDelta: delta,
          p2LocalBounds: mesh.bounds,
          webLocalBounds: fallback.bounds,
          p2Bounds,
          webBounds,
          p2Triangles: mesh.triangles,
          webIfcTriangles: fallback.triangles,
          ...(exact ? { exactBoundDelta, nativeExactWorldBounds, webExactWorldBounds } : {}),
        };
        addMismatch(mismatch);
      }
      comparedInstances++;
    }
  });
} finally {
  api.CloseModel(modelId);
}

console.log(JSON.stringify({
  sourceSha256,
  comparedProducts,
  comparedInstances,
  uniqueWebIfcGeometries: webGeometry.size,
  maximumBoundDelta,
  ...(exact ? { maximumExactBoundDelta, exactOverOneMillimetre, exactOverOneCentimetre,
    exactOverTenCentimetres, exactByBooleanFamily, largestExactBoundDeltas: largestExactBoundDeltas
      .sort((left, right) => right.exactBoundDelta - left.exactBoundDelta).slice(0, 20) } : {}),
  triangleDifference,
  mismatchCount,
  mismatches,
}, null, 2));

function addMismatch(mismatch) {
  mismatchCount++;
  if (mismatches.length < 20) mismatches.push(mismatch);
}

function readAffine3X4(bytes, offset) {
  const values = Array.from({ length: 12 }, (_, index) => bytes.readDoubleLE(offset + index * 8));
  return [
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    values[9], values[10], values[11], 1,
  ];
}

function multiply4X4(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let inner = 0; inner < 4; inner++) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}

function transformBounds(bounds, matrix) {
  const result = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const x of [bounds[0], bounds[3]]) {
    for (const y of [bounds[1], bounds[4]]) {
      for (const z of [bounds[2], bounds[5]]) {
        const transformed = [
          matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
          matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
          matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        ];
        result[0] = Math.min(result[0], transformed[0]);
        result[1] = Math.min(result[1], transformed[1]);
        result[2] = Math.min(result[2], transformed[2]);
        result[3] = Math.max(result[3], transformed[0]);
        result[4] = Math.max(result[4], transformed[1]);
        result[5] = Math.max(result[5], transformed[2]);
      }
    }
  }
  return result;
}

function nativeWorldBounds(mesh, matrix) {
  const result = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let item = 0; item < mesh.triangles * 3; item++) {
    const ordinal = indexBytes.readUInt32LE(32 + (mesh.firstIndex + item) * 4);
    const offset = 32 + ordinal * 32;
    includeTransformed(result, positionBytes.readDoubleLE(offset + 8),
      positionBytes.readDoubleLE(offset + 16), positionBytes.readDoubleLE(offset + 24), matrix);
  }
  return result;
}

function webWorldBounds(vertices, matrix) {
  const result = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < vertices.length; vertex += 6)
    includeTransformed(result, vertices[vertex], vertices[vertex + 1], vertices[vertex + 2], matrix);
  return result;
}

function includeTransformed(bounds, x, y, z, matrix) {
  for (let axis = 0; axis < 3; axis++) {
    const value = matrix[axis] * x + matrix[axis + 4] * y + matrix[axis + 8] * z + matrix[axis + 12];
    bounds[axis] = Math.min(bounds[axis], value);
    bounds[axis + 3] = Math.max(bounds[axis + 3], value);
  }
}
