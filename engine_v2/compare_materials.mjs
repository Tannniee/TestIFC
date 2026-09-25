import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IfcAPI } from "../frontend/node_modules/web-ifc/web-ifc-api-node.js";

const [sourceArgument, artifactArgument] = process.argv.slice(2);
if (!sourceArgument || !artifactArgument) {
  console.error("Usage: node engine_v2/compare_materials.mjs <model.ifc> <chunk-directory>");
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

const materials = new Map();
const materialBytes = fs.readFileSync(path.join(artifactDirectory, "materials.ifcv2"));
for (let offset = 32; offset < materialBytes.length; offset += 32) {
  materials.set(materialBytes.readUInt32LE(offset), {
    sourceStyledItemId: materialBytes.readInt32LE(offset + 4),
    sourceColourId: materialBytes.readInt32LE(offset + 8),
    flags: materialBytes.readUInt32LE(offset + 12),
    color: Array.from({ length: 4 }, (_, index) => materialBytes.readFloatLE(offset + 16 + index * 4)),
  });
}

const assignments = fs.readFileSync(path.join(artifactDirectory, "instance-materials.ifcv2"));
const products = new Map();
const productBytes = fs.readFileSync(path.join(artifactDirectory, "products.ifcv2"));
for (let offset = 32; offset < productBytes.length; offset += 24) {
  products.set(productBytes.readInt32LE(offset), {
    firstInstance: Number(productBytes.readBigInt64LE(offset + 8)),
    instanceCount: productBytes.readInt32LE(offset + 16),
  });
}

let comparedProducts = 0;
let comparedInstances = 0;
let mismatchCount = 0;
let maximumChannelDelta = 0;
const mismatches = [];
const api = new IfcAPI();
await api.Init();
const modelId = api.OpenModel(source, { COORDINATE_TO_ORIGIN: false });
try {
  api.StreamAllMeshes(modelId, (flatMesh) => {
    comparedProducts++;
    const range = products.get(flatMesh.expressID);
    if (!range || range.instanceCount !== flatMesh.geometries.size()) {
      addMismatch({
        productExpressId: flatMesh.expressID,
        reason: "instance-range",
        p3: range?.instanceCount ?? null,
        webIfc: flatMesh.geometries.size(),
      });
      return;
    }
    for (let index = 0; index < range.instanceCount; index++) {
      const placed = flatMesh.geometries.get(index);
      const assignmentOffset = 32 + (range.firstInstance + index) * 4;
      const materialOrdinal = assignments.readUInt32LE(assignmentOffset);
      const material = materials.get(materialOrdinal);
      if (!material) {
        addMismatch({ productExpressId: flatMesh.expressID, index, materialOrdinal, reason: "missing-material" });
        continue;
      }
      const fallback = [placed.color.x, placed.color.y, placed.color.z, placed.color.w];
      const delta = Math.max(...material.color.map((value, channel) => Math.abs(value - fallback[channel])));
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
      if (delta > 1e-6) {
        addMismatch({
          productExpressId: flatMesh.expressID,
          index,
          materialOrdinal,
          sourceStyledItemId: material.sourceStyledItemId,
          sourceColourId: material.sourceColourId,
          p3: material.color,
          webIfc: fallback,
          delta,
        });
      }
      comparedInstances++;
    }
  });
} finally {
  api.CloseModel(modelId);
}

console.log(JSON.stringify({
  sourceSha256,
  materialDefinitions: materials.size,
  comparedProducts,
  comparedInstances,
  maximumChannelDelta,
  mismatchCount,
  mismatches,
}, null, 2));

function addMismatch(mismatch) {
  mismatchCount++;
  if (mismatches.length < 20) mismatches.push(mismatch);
}
