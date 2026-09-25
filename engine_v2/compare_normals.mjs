import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IfcAPI } from "../frontend/node_modules/web-ifc/web-ifc-api-node.js";

const [sourceArgument, artifactArgument] = process.argv.slice(2);
const limitArgument = process.argv.indexOf("--limit");
const baseLimit = limitArgument >= 0 ? Number(process.argv[limitArgument + 1]) : Infinity;
if (!sourceArgument || !artifactArgument || !(baseLimit > 0)) {
  console.error("Usage: node engine_v2/compare_normals.mjs <model.ifc> <chunk-directory> [--limit <bases>]");
  process.exit(2);
}

const sourcePath = path.resolve(sourceArgument);
const artifactDirectory = path.resolve(artifactArgument);
const manifest = JSON.parse(fs.readFileSync(path.join(artifactDirectory, "manifest.json"), "utf8"));
const source = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash("sha256").update(source).digest("hex").toUpperCase();
if (sourceSha256 !== manifest.sourceSha256) throw new Error("Source SHA-256 does not match the artifact.");
for (const chunk of manifest.chunks) {
  const bytes = fs.readFileSync(path.join(artifactDirectory, chunk.file));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (sha256 !== chunk.sha256) throw new Error(`Chunk checksum mismatch: ${chunk.file}`);
}

const normals = fs.readFileSync(path.join(artifactDirectory, "normals.ifcv2"));
const meshes = fs.readFileSync(path.join(artifactDirectory, "meshes.ifcv2"));
const targetsByProduct = new Map();
let selectedBases = 0;
for (let offset = 32; offset < meshes.length && selectedBases < baseLimit; offset += 56) {
  const baseId = meshes.readInt32LE(offset);
  const productId = meshes.readInt32LE(offset + 4);
  const record = {
    baseId,
    firstIndex: Number(meshes.readBigInt64LE(offset + 8)),
    indexCount: meshes.readInt32LE(offset + 16),
  };
  const targets = targetsByProduct.get(productId) ?? [];
  targets.push(record);
  targetsByProduct.set(productId, targets);
  selectedBases++;
}

let comparedBases = 0;
let comparedTriangles = 0;
let missingBases = 0;
let triangleCountMismatches = 0;
let reversedTriangles = 0;
let invalidTriangles = 0;
let webIfcFloat32ZeroAreaTriangles = 0;
let normalMismatches = 0;
let maximumNormalDelta = 0;
let minimumNormalDot = 1;
const mismatches = [];
const api = new IfcAPI();
await api.Init();
const modelId = api.OpenModel(source, { COORDINATE_TO_ORIGIN: false });
try {
  api.StreamAllMeshes(modelId, (flatMesh) => {
    const targets = targetsByProduct.get(flatMesh.expressID);
    if (!targets) return;
    const placedByGeometry = new Map();
    for (let index = 0; index < flatMesh.geometries.size(); index++) {
      const placed = flatMesh.geometries.get(index);
      placedByGeometry.set(placed.geometryExpressID, placed);
    }
    for (const target of targets) {
      let placed = placedByGeometry.get(target.baseId);
      if (!placed && targets.length === 1 && flatMesh.geometries.size() === 1) placed = flatMesh.geometries.get(0);
      if (!placed) {
        missingBases++;
        addMismatch({ baseId: target.baseId, productId: flatMesh.expressID, reason: "missing-webifc-geometry" });
        continue;
      }
      const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
      try {
        const webVertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const webIndices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        if (webIndices.length !== target.indexCount) {
          triangleCountMismatches++;
          addMismatch({
            baseId: target.baseId,
            productId: flatMesh.expressID,
            reason: "index-count",
            p3: target.indexCount,
            webIfc: webIndices.length,
          });
          continue;
        }
        const artifactNormals = [];
        const webIfcNormals = [];
        for (let triangle = 0; triangle < target.indexCount; triangle += 3) {
          const p3Normal = artifactNormal(target.firstIndex + triangle);
          const webNormal = geometryNormal(webVertices, webIndices, triangle);
          if (geometryCrossLength(webVertices, webIndices, triangle) === 0) webIfcFloat32ZeroAreaTriangles++;
          if (!p3Normal || !webNormal) {
            invalidTriangles++;
            continue;
          }
          artifactNormals.push(p3Normal);
          webIfcNormals.push(webNormal);
        }
        matchNormalSets(target.baseId, artifactNormals, webIfcNormals);
        comparedBases++;
      } finally {
        geometry.delete();
      }
    }
    targetsByProduct.delete(flatMesh.expressID);
  });
} finally {
  api.CloseModel(modelId);
}

for (const targets of targetsByProduct.values()) missingBases += targets.length;
console.log(JSON.stringify({
  sourceSha256,
  selectedBases,
  comparedBases,
  comparedTriangles,
  missingBases,
  triangleCountMismatches,
  invalidTriangles,
  webIfcFloat32ZeroAreaTriangles,
  reversedTriangles,
  normalMismatches,
  minimumNormalDot,
  maximumNormalDelta,
  mismatches,
}, null, 2));

function artifactNormal(firstIndex) {
  const normalOffset = 32 + (firstIndex / 3) * 4;
  let x = normals.readInt16LE(normalOffset) / 32767;
  let y = normals.readInt16LE(normalOffset + 2) / 32767;
  let z = 1 - Math.abs(x) - Math.abs(y);
  const fold = Math.max(-z, 0);
  x += x >= 0 ? -fold : fold;
  y += y >= 0 ? -fold : fold;
  const length = Math.hypot(x, y, z);
  return length > 0 ? [x / length, y / length, z / length] : null;
}

function geometryNormal(vertices, geometryIndices, triangle) {
  const ordinal = geometryIndices[triangle];
  const normal = [vertices[ordinal * 6 + 3], vertices[ordinal * 6 + 4], vertices[ordinal * 6 + 5]];
  const length = Math.hypot(...normal);
  return Number.isFinite(length) && length > 0 ? normal.map((value) => value / length) : null;
}

function geometryCrossLength(vertices, geometryIndices, triangle) {
  const points = [0, 1, 2].map((index) => {
    const ordinal = geometryIndices[triangle + index];
    return [vertices[ordinal * 6], vertices[ordinal * 6 + 1], vertices[ordinal * 6 + 2]];
  });
  const ab = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]];
  const ac = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]];
  return Math.hypot(
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  );
}

function dot3(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function matchNormalSets(baseId, artifactNormals, webIfcNormals) {
  const buckets = new Map();
  for (const normal of webIfcNormals) {
    const key = normalKey(normal);
    const bucket = buckets.get(key) ?? [];
    bucket.push(normal);
    buckets.set(key, bucket);
  }
  const unmatchedArtifact = [];
  for (const normal of artifactNormals) {
    const bucket = buckets.get(normalKey(normal));
    if (!bucket?.length) {
      unmatchedArtifact.push(normal);
      continue;
    }
    recordNormalMatch(baseId, normal, bucket.pop());
  }
  const unmatchedWebIfc = [];
  for (const bucket of buckets.values()) unmatchedWebIfc.push(...bucket);
  for (const normal of unmatchedArtifact) {
    let bestIndex = -1;
    let bestDot = -Infinity;
    for (let index = 0; index < unmatchedWebIfc.length; index++) {
      const candidateDot = dot3(normal, unmatchedWebIfc[index]);
      if (candidateDot <= bestDot) continue;
      bestDot = candidateDot;
      bestIndex = index;
    }
    if (bestIndex < 0) {
      invalidTriangles++;
      continue;
    }
    const matched = unmatchedWebIfc[bestIndex];
    unmatchedWebIfc[bestIndex] = unmatchedWebIfc[unmatchedWebIfc.length - 1];
    unmatchedWebIfc.pop();
    recordNormalMatch(baseId, normal, matched);
  }
  invalidTriangles += unmatchedWebIfc.length;
}

function recordNormalMatch(baseId, p3Normal, webNormal) {
  const dot = clamp(dot3(p3Normal, webNormal), -1, 1);
  const delta = Math.sqrt(
    (p3Normal[0] - webNormal[0]) ** 2 +
    (p3Normal[1] - webNormal[1]) ** 2 +
    (p3Normal[2] - webNormal[2]) ** 2
  );
  minimumNormalDot = Math.min(minimumNormalDot, dot);
  maximumNormalDelta = Math.max(maximumNormalDelta, delta);
  if (dot < 0) reversedTriangles++;
  if (dot < 0.9999) {
    normalMismatches++;
    if (mismatches.length < 20) mismatches.push({ baseId, p3Normal, webNormal, dot });
  }
  comparedTriangles++;
}

function normalKey(normal) {
  return normal.map((value) => Math.round(value * 10_000)).join(",");
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function addMismatch(mismatch) {
  if (mismatches.length < 20) mismatches.push(mismatch);
}
