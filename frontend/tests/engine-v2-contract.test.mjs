import assert from "node:assert/strict";
import test from "node:test";

import { EngineV2ArtifactContract } from "../src/lib/engine-v2/artifact-contract.ts";
import { ENGINE_V2_RENDER_CHUNKS, readEngineV2Artifact } from "../src/lib/engine-v2/artifact-reader.ts";
import {
  ENGINE_V2_CHUNKS,
  ENGINE_V2_MATERIAL_POLICY,
  ENGINE_V2_NORMAL_POLICY,
  ENGINE_V2_POSITION_POLICY,
  validateEngineV2Manifest,
} from "../src/lib/engine-v2/manifest.ts";

const sourceHash = "a".repeat(64);
const counts = { cartesianPoints: 2, baseDefinitions: 1, products: 1, instances: 1, triangles: 1, expandedTriangles: 1, indices: 3 };

function fixture() {
  const semantic = { status: "complete", records: 1, parentLinks: 0, roots: 1, representedProducts: 1, stringBytes: 4,
    deep: { status: "complete", records: 1, productsWithRelations: 1, relationEdges: 3, valueBytes: 2, maximumRecordBytes: 2 } };
  const countValues = { ...counts, materialDefinitions: 1, semanticRecords: semantic.records, semanticStringBytes: semantic.stringBytes,
    semanticDeepRecords: semantic.deep.records, semanticDeepValueBytes: semantic.deep.valueBytes };
  const chunks = Object.entries(ENGINE_V2_CHUNKS).map(([file, layout]) => {
    const recordCount = countValues[layout.count];
    const payloadBytes = recordCount * layout.stride;
    return { file, kind: layout.kind, sizeBytes: payloadBytes + 32, payloadBytes, recordCount, sha256: "b".repeat(64) };
  });
  return {
    format: "ifc-engine-v2-tessellation",
    version: 5,
    engineVersion: "0.8.9-p6.2",
    complete: true,
    viewerReady: true,
    directory: "C:/untrusted/worker/path",
    sourceSha256: sourceHash.toUpperCase(),
    coordinateSpace: "ifc-local-source-units",
    ...counts,
    nonSimpleFaces: 0,
    recoveredDisjointFaces: 0,
    nonSimpleFaceDetails: [],
    lengthUnitScaleToMetres: 0.001,
    sourceToViewerTransform: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1],
    positionPolicy: ENGINE_V2_POSITION_POLICY,
    normalPolicy: ENGINE_V2_NORMAL_POLICY,
    materials: { status: "complete", assignmentPolicy: ENGINE_V2_MATERIAL_POLICY, materialDefinitions: 1, instanceAssignments: 1 },
    typeNames: ["IFCWALL"],
    semantic,
    chunks,
  };
}

function header(descriptor) {
  const bytes = new Uint8Array(32);
  bytes.set(Buffer.from("IFCV2CHK"));
  const view = new DataView(bytes.buffer);
  view.setUint16(8, 1, true);
  view.setUint16(10, descriptor.kind, true);
  view.setUint32(12, 32, true);
  view.setBigUint64(16, BigInt(descriptor.payloadBytes), true);
  view.setUint32(24, descriptor.recordCount, true);
  return bytes;
}

function chunk(descriptor) {
  const bytes = new Uint8Array(descriptor.sizeBytes);
  bytes.set(header(descriptor));
  return bytes.buffer;
}

test("manifest v5 accepts geometry plus complete native semantics", () => {
  const validated = validateEngineV2Manifest(fixture(), sourceHash);
  assert.equal(validated.chunks.length, 13);
  assert.equal(validated.sourceSha256.toLowerCase(), sourceHash);
});

test("manifest exposes a verified disjoint-bound recovery count", () => {
  const recovered = fixture();
  recovered.nonSimpleFaces = 1;
  recovered.recoveredDisjointFaces = 1;
  recovered.nonSimpleFaceDetails = [{ recoveredIslands: 2, holes: 2, triangles: 4,
    empty: false, containmentRejected: false }];
  assert.equal(validateEngineV2Manifest(recovered, sourceHash).recoveredDisjointFaces, 1);
});

test("manifest rejects source, coverage, chunk, and count drift", () => {
  assert.throws(() => validateEngineV2Manifest(fixture(), "c".repeat(64)), /source hash mismatch/);
  const preGuard = fixture();
  preGuard.engineVersion = "0.8.0-p6.2";
  assert.throws(() => validateEngineV2Manifest(preGuard, sourceHash), /engineVersion/);
  const incomplete = fixture();
  incomplete.viewerReady = false;
  assert.throws(() => validateEngineV2Manifest(incomplete, sourceHash), /viewerReady/);
  const duplicate = fixture();
  duplicate.chunks[1].file = duplicate.chunks[0].file;
  assert.throws(() => validateEngineV2Manifest(duplicate, sourceHash), /duplicate/);
  const wrongTriangles = fixture();
  wrongTriangles.indices = 6;
  assert.throws(() => validateEngineV2Manifest(wrongTriangles, sourceHash), /triangle and index/);
  const wrongRecovery = fixture();
  wrongRecovery.recoveredDisjointFaces = 1;
  assert.throws(() => validateEngineV2Manifest(wrongRecovery, sourceHash), /non-simple face diagnostics/);
});

test("artifact contract verifies binary header before a renderer sees payload bytes", () => {
  const contract = new EngineV2ArtifactContract(fixture(), sourceHash);
  const descriptor = contract.manifest.chunks.find((chunk) => chunk.file === "positions.ifcv2");
  assert.equal(contract.validateChunkHeader("positions.ifcv2", header(descriptor), descriptor.sizeBytes).kind, 1);
  const corrupt = header(descriptor);
  corrupt[0] = 0;
  assert.throws(() => contract.validateChunkHeader("positions.ifcv2", corrupt), /magic/);
});

test("artifact reader limits concurrency and reports complete renderer input", async () => {
  const raw = fixture();
  let active = 0, maximumActive = 0;
  const progress = [];
  const transport = {
    getManifest: async () => raw,
    getChunk: async (_artifactKey, file) => {
      active++; maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return chunk(raw.chunks.find(candidate => candidate.file === file));
    },
  };
  const artifact = await readEngineV2Artifact(transport, "artifact", sourceHash, new AbortController().signal, value => progress.push(value));
  assert.equal(Object.keys(artifact.chunks).length, ENGINE_V2_RENDER_CHUNKS.length);
  assert.ok(maximumActive <= 3);
  assert.equal(progress.at(-1).completedChunks, ENGINE_V2_RENDER_CHUNKS.length);
  assert.equal(progress.at(-1).completedBytes, progress.at(-1).totalBytes);
});

test("artifact reader aborts sibling downloads after corrupt input", async () => {
  const raw = fixture();
  let siblingAborts = 0;
  const transport = {
    getManifest: async () => raw,
    getChunk: async (_artifactKey, file, signal) => {
      if (file === ENGINE_V2_RENDER_CHUNKS[0]) return new ArrayBuffer(32);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        siblingAborts++;
        reject(signal.reason);
      }, { once: true }));
    },
  };
  await assert.rejects(
    readEngineV2Artifact(transport, "artifact", sourceHash, new AbortController().signal),
    /magic/,
  );
  assert.ok(siblingAborts >= 1);
});
