import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [sourceArgument, artifactArgument] = process.argv.slice(2);
if (!sourceArgument || !artifactArgument) {
  console.error("Usage: node engine_v2/validate_renderer_positions.mjs <model.ifc> <chunk-directory>");
  process.exit(2);
}

const sourcePath = path.resolve(sourceArgument);
const artifactDirectory = path.resolve(artifactArgument);
const manifest = JSON.parse(fs.readFileSync(path.join(artifactDirectory, "manifest.json"), "utf8"));
const sourceSha256 = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex").toUpperCase();
if (sourceSha256 !== manifest.sourceSha256) throw new Error("Source SHA-256 does not match the artifact.");
for (const chunk of manifest.chunks) {
  const bytes = fs.readFileSync(path.join(artifactDirectory, chunk.file));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (sha256 !== chunk.sha256) throw new Error(`Chunk checksum mismatch: ${chunk.file}`);
}

const positions = fs.readFileSync(path.join(artifactDirectory, "positions-f64.ifcv2"));
const indices = fs.readFileSync(path.join(artifactDirectory, "indices.ifcv2"));
const meshes = fs.readFileSync(path.join(artifactDirectory, "meshes.ifcv2"));
let comparedMeshes = 0;
let comparedTriangles = 0;
let sourceZeroAreaTriangles = 0;
let float32CollapsedTriangles = 0;
let invalidTriangles = 0;
let maximumRebasedCoordinate = 0;
const failures = [];

for (let meshOffset = 32; meshOffset < meshes.length; meshOffset += 56) {
  const baseId = meshes.readInt32LE(meshOffset);
  const firstIndex = Number(meshes.readBigInt64LE(meshOffset + 8));
  const indexCount = meshes.readInt32LE(meshOffset + 16);
  for (let localIndex = 0; localIndex < indexCount; localIndex += 3) {
    const points = [0, 1, 2].map((corner) =>
      readPosition(indices.readUInt32LE(32 + (firstIndex + localIndex + corner) * 4))
    );
    const sourceCross = cross(points[0], points[1], points[2]);
    const sourceLength = Math.hypot(...sourceCross);
    if (!Number.isFinite(sourceLength)) {
      invalidTriangles++;
      addFailure({ baseId, triangle: localIndex / 3, reason: "non-finite-source" });
      continue;
    }
    if (sourceLength === 0) sourceZeroAreaTriangles++;

    const rebased = points.map((point) => point.map((value, axis) => {
      const converted = Math.fround(value - points[0][axis]);
      maximumRebasedCoordinate = Math.max(maximumRebasedCoordinate, Math.abs(converted));
      return converted;
    }));
    const floatLength = Math.hypot(...cross(rebased[0], rebased[1], rebased[2]));
    if (sourceLength > 0 && floatLength === 0) {
      float32CollapsedTriangles++;
      addFailure({ baseId, triangle: localIndex / 3, reason: "float32-collapse-after-triangle-rebase" });
    }
    comparedTriangles++;
  }
  comparedMeshes++;
}

console.log(JSON.stringify({
  sourceSha256,
  positionPolicy: manifest.positionPolicy,
  comparedMeshes,
  comparedTriangles,
  sourceZeroAreaTriangles,
  float32CollapsedTriangles,
  invalidTriangles,
  maximumRebasedCoordinate,
  failures,
}, null, 2));

function readPosition(ordinal) {
  const offset = 32 + ordinal * 32;
  return [
    positions.readDoubleLE(offset + 8),
    positions.readDoubleLE(offset + 16),
    positions.readDoubleLE(offset + 24),
  ];
}

function cross(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
}

function addFailure(failure) {
  if (failures.length < 20) failures.push(failure);
}
