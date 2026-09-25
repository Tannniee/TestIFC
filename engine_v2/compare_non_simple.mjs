import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IfcAPI } from "../frontend/node_modules/web-ifc/web-ifc-api-node.js";

const [sourceArgument, artifactArgument] = process.argv.slice(2);
const compareAll = process.argv.includes("--all");
if (!sourceArgument || !artifactArgument) {
  console.error("Usage: node engine_v2/compare_non_simple.mjs <model.ifc> <chunk-directory> [--all]");
  process.exit(2);
}

const sourcePath = path.resolve(sourceArgument);
const artifactDirectory = path.resolve(artifactArgument);
const manifest = JSON.parse(fs.readFileSync(path.join(artifactDirectory, "manifest.json"), "utf8"));
const source = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash("sha256").update(source).digest("hex").toUpperCase();
if (sourceSha256 !== manifest.sourceSha256) {
  throw new Error(`Source SHA-256 does not match the artifact: ${sourceSha256}`);
}
const meshBytes = fs.readFileSync(path.join(artifactDirectory, "meshes.ifcv2"));
const meshManifest = manifest.chunks.find((chunk) => chunk.kind === 2);
const meshRecordBytes = meshManifest.payloadBytes / meshManifest.recordCount;
if (!Number.isInteger(meshRecordBytes) || meshRecordBytes < 56) throw new Error("Unsupported MeshTable record size.");
const meshRecords = new Map();
for (let offset = 32; offset < meshBytes.length; offset += meshRecordBytes) {
  const baseId = meshBytes.readInt32LE(offset);
  const productId = meshBytes.readInt32LE(offset + 4);
  const indexCount = meshBytes.readInt32LE(offset + 16);
  const occurrences = meshBytes.readInt32LE(offset + 24);
  meshRecords.set(baseId, { productId, occurrences, triangles: indexCount / 3 });
}

const detailsByBase = new Map();
if (compareAll) {
  for (const [baseId, record] of meshRecords) {
    detailsByBase.set(baseId, { productId: record.productId, occurrences: record.occurrences, faceIds: [] });
  }
}
for (const detail of manifest.nonSimpleFaceDetails ?? []) {
  const current = detailsByBase.get(detail.baseDefinitionExpressId) ?? {
    productId: detail.representativeProductExpressId,
    occurrences: detail.occurrences,
    faceIds: [],
  };
  current.faceIds.push(detail.faceExpressId);
  detailsByBase.set(detail.baseDefinitionExpressId, current);
}

const products = new Map();
for (const [baseId, detail] of detailsByBase) {
  if (!detail.productId) throw new Error(`Base definition #${baseId} has no representative product.`);
  const bases = products.get(detail.productId) ?? [];
  bases.push(baseId);
  products.set(detail.productId, bases);
}

const api = new IfcAPI();
await api.Init();
const modelId = api.OpenModel(source, { COORDINATE_TO_ORIGIN: false });
const webIfcTriangles = new Map();
try {
  for (const [productId, targetBases] of products) {
    const targetSet = new Set(targetBases);
    const mesh = api.GetFlatMesh(modelId, productId);
    for (let index = 0; index < mesh.geometries.size(); index++) {
      const placed = mesh.geometries.get(index);
      const baseId = targetSet.has(placed.geometryExpressID)
        ? placed.geometryExpressID
        : targetBases.length === 1 && mesh.geometries.size() === 1
          ? targetBases[0]
          : null;
      if (baseId === null || webIfcTriangles.has(baseId)) continue;
      const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
      webIfcTriangles.set(baseId, geometry.GetIndexDataSize() / 3);
      geometry.delete();
    }
  }
} finally {
  api.CloseModel(modelId);
}

const comparisons = [...detailsByBase].map(([baseId, detail]) => ({
  baseDefinitionExpressId: baseId,
  representativeProductExpressId: detail.productId,
  occurrences: detail.occurrences,
  faceExpressIds: [...new Set(detail.faceIds)].sort((a, b) => a - b),
  p1Triangles: meshRecords.get(baseId)?.triangles,
  webIfcTriangles: webIfcTriangles.get(baseId) ?? null,
  difference: webIfcTriangles.has(baseId) ? meshRecords.get(baseId)?.triangles - webIfcTriangles.get(baseId) : null,
  expandedDifference: webIfcTriangles.has(baseId)
    ? (meshRecords.get(baseId)?.triangles - webIfcTriangles.get(baseId)) * detail.occurrences
    : null,
}));
const missing = comparisons.filter((entry) => entry.webIfcTriangles === null);
const mismatches = comparisons.filter((entry) => typeof entry.difference === "number" && entry.difference !== 0);
console.log(JSON.stringify({
  sourceSha256,
  comparedBases: comparisons.length - missing.length,
  missingBases: missing.length,
  mismatchedBases: mismatches.length,
  totalDifference: mismatches.reduce((sum, entry) => sum + (entry.difference ?? 0), 0),
  totalExpandedDifference: mismatches.reduce((sum, entry) => sum + (entry.expandedDifference ?? 0), 0),
  missing,
  mismatches,
}, null, 2));
