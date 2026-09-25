export const ENGINE_V2_FORMAT = "ifc-engine-v2-tessellation";
export const ENGINE_V2_MANIFEST_VERSION = 5;
export const ENGINE_V2_ENGINE_VERSION = "0.8.9-p6.2";
export const ENGINE_V2_POSITION_POLICY = "float64-source-adaptive-triangle-cluster-rebase-before-float32-upload";
export const ENGINE_V2_NORMAL_POLICY = "octahedral-snorm16-per-triangle";
export const ENGINE_V2_MATERIAL_POLICY = "base-style-then-mapped-item-style-then-first-material-layer-style-then-default";

export const ENGINE_V2_CHUNKS = {
  "positions.ifcv2": { kind: 1, stride: 16, count: "cartesianPoints" },
  "meshes.ifcv2": { kind: 2, stride: 56, count: "baseDefinitions" },
  "indices.ifcv2": { kind: 3, stride: 4, count: "indices" },
  "instances.ifcv2": { kind: 4, stride: 112, count: "instances" },
  "products.ifcv2": { kind: 5, stride: 24, count: "products" },
  "materials.ifcv2": { kind: 6, stride: 32, count: "materialDefinitions" },
  "instance-materials.ifcv2": { kind: 7, stride: 4, count: "instances" },
  "normals.ifcv2": { kind: 8, stride: 4, count: "triangles" },
  "positions-f64.ifcv2": { kind: 9, stride: 32, count: "cartesianPoints" },
  "semantic-records.ifcv2": { kind: 10, stride: 48, count: "semanticRecords" },
  "semantic-strings.ifcv2": { kind: 11, stride: 1, count: "semanticStringBytes" },
  "semantic-deep-index.ifcv2": { kind: 12, stride: 24, count: "semanticDeepRecords" },
  "semantic-deep-values.ifcv2": { kind: 13, stride: 1, count: "semanticDeepValueBytes" },
} as const;

export type EngineV2ChunkFile = keyof typeof ENGINE_V2_CHUNKS;

export interface EngineV2ChunkDescriptor {
  file: EngineV2ChunkFile;
  kind: number;
  sizeBytes: number;
  payloadBytes: number;
  recordCount: number;
  sha256: string;
}

export interface EngineV2Manifest {
  format: typeof ENGINE_V2_FORMAT;
  version: typeof ENGINE_V2_MANIFEST_VERSION;
  engineVersion: typeof ENGINE_V2_ENGINE_VERSION;
  complete: true;
  viewerReady: true;
  sourceSha256: string;
  coordinateSpace: "ifc-local-source-units";
  cartesianPoints: number;
  baseDefinitions: number;
  products: number;
  instances: number;
  triangles: number;
  expandedTriangles: number;
  indices: number;
  recoveredDisjointFaces: number;
  lengthUnitScaleToMetres: number;
  sourceToViewerTransform: number[];
  positionPolicy: typeof ENGINE_V2_POSITION_POLICY;
  normalPolicy: typeof ENGINE_V2_NORMAL_POLICY;
  materials: {
    status: "complete";
    assignmentPolicy: typeof ENGINE_V2_MATERIAL_POLICY;
    materialDefinitions: number;
    instanceAssignments: number;
  };
  typeNames: string[];
  semantic: {
    status: "complete";
    records: number;
    parentLinks: number;
    roots: number;
    representedProducts: number;
    stringBytes: number;
    deep: {
      status: "complete";
      records: number;
      productsWithRelations: number;
      relationEdges: number;
      valueBytes: number;
      maximumRecordBytes: number;
    };
  };
  chunks: EngineV2ChunkDescriptor[];
  [key: string]: unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff) {
    throw new Error(`${label} must be a uint32-safe integer`);
  }
  return value as number;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function exact(source: Record<string, unknown>, field: string, expected: unknown): void {
  if (source[field] !== expected) throw new Error(`unsupported Engine V2 ${field}`);
}

export function validateEngineV2Manifest(value: unknown, expectedSourceHash: string): EngineV2Manifest {
  const manifest = record(value, "manifest");
  exact(manifest, "format", ENGINE_V2_FORMAT);
  exact(manifest, "version", ENGINE_V2_MANIFEST_VERSION);
  exact(manifest, "engineVersion", ENGINE_V2_ENGINE_VERSION);
  exact(manifest, "complete", true);
  exact(manifest, "viewerReady", true);
  exact(manifest, "coordinateSpace", "ifc-local-source-units");
  exact(manifest, "positionPolicy", ENGINE_V2_POSITION_POLICY);
  exact(manifest, "normalPolicy", ENGINE_V2_NORMAL_POLICY);
  if (!/^[0-9a-f]{64}$/i.test(expectedSourceHash)) throw new Error("expected source hash is invalid");
  if (typeof manifest.sourceSha256 !== "string" || manifest.sourceSha256.toLowerCase() !== expectedSourceHash.toLowerCase()) {
    throw new Error("Engine V2 source hash mismatch");
  }

  const counts = {
    cartesianPoints: integer(manifest.cartesianPoints, "cartesianPoints"),
    baseDefinitions: integer(manifest.baseDefinitions, "baseDefinitions"),
    products: integer(manifest.products, "products"),
    instances: integer(manifest.instances, "instances"),
    triangles: integer(manifest.triangles, "triangles"),
    expandedTriangles: integer(manifest.expandedTriangles, "expandedTriangles"),
    indices: integer(manifest.indices, "indices"),
  };
  if (counts.indices !== counts.triangles * 3) throw new Error("triangle and index counts are inconsistent");
  const nonSimple = integer(manifest.nonSimpleFaces, "nonSimpleFaces");
  const recovered = integer(manifest.recoveredDisjointFaces, "recoveredDisjointFaces");
  if (!Array.isArray(manifest.nonSimpleFaceDetails) || manifest.nonSimpleFaceDetails.length !== nonSimple || recovered > nonSimple) {
    throw new Error("non-simple face diagnostics are inconsistent");
  }
  let recoveredDetails = 0;
  for (const value of manifest.nonSimpleFaceDetails) {
    const detail = record(value, "nonSimpleFaceDetails entry");
    const islands = integer(detail.recoveredIslands, "recoveredIslands");
    if (islands > 0) {
      recoveredDetails++;
      if (islands > integer(detail.holes, "holes") ||
          integer(detail.triangles, "triangles") === 0 || detail.empty !== false ||
          detail.containmentRejected !== false) throw new Error("recovered face is marked incomplete");
    }
  }
  if (recoveredDetails !== recovered) throw new Error("recovered face count is inconsistent");
  const scale = finite(manifest.lengthUnitScaleToMetres, "lengthUnitScaleToMetres");
  if (scale <= 0) throw new Error("lengthUnitScaleToMetres must be positive");
  if (!Array.isArray(manifest.sourceToViewerTransform) || manifest.sourceToViewerTransform.length !== 16) {
    throw new Error("sourceToViewerTransform must contain 16 values");
  }
  manifest.sourceToViewerTransform.forEach((entry, index) => finite(entry, `sourceToViewerTransform[${index}]`));

  const materials = record(manifest.materials, "materials");
  exact(materials, "status", "complete");
  exact(materials, "assignmentPolicy", ENGINE_V2_MATERIAL_POLICY);
  const materialDefinitions = integer(materials.materialDefinitions, "materials.materialDefinitions");
  const instanceAssignments = integer(materials.instanceAssignments, "materials.instanceAssignments");
  if (materialDefinitions === 0 || instanceAssignments !== counts.instances) throw new Error("material counts are inconsistent");

  if (!Array.isArray(manifest.typeNames) || manifest.typeNames.length === 0 || manifest.typeNames.length > 0xffff ||
      manifest.typeNames.some(value => typeof value !== "string" || !value)) {
    throw new Error("typeNames must contain the source entity registry");
  }
  const semantic = record(manifest.semantic, "semantic");
  exact(semantic, "status", "complete");
  const semanticRecords = integer(semantic.records, "semantic.records");
  const parentLinks = integer(semantic.parentLinks, "semantic.parentLinks");
  const roots = integer(semantic.roots, "semantic.roots");
  const representedProducts = integer(semantic.representedProducts, "semantic.representedProducts");
  const semanticStringBytes = integer(semantic.stringBytes, "semantic.stringBytes");
  if (!semanticRecords || parentLinks + roots !== semanticRecords || representedProducts !== counts.products) {
    throw new Error("semantic-core counts are inconsistent");
  }
  const deep = record(semantic.deep, "semantic.deep");
  exact(deep, "status", "complete");
  const semanticDeepRecords = integer(deep.records, "semantic.deep.records");
  const productsWithRelations = integer(deep.productsWithRelations, "semantic.deep.productsWithRelations");
  const relationEdges = integer(deep.relationEdges, "semantic.deep.relationEdges");
  const semanticDeepValueBytes = integer(deep.valueBytes, "semantic.deep.valueBytes");
  const maximumRecordBytes = integer(deep.maximumRecordBytes, "semantic.deep.maximumRecordBytes");
  if (semanticDeepRecords !== representedProducts || productsWithRelations > semanticDeepRecords ||
      maximumRecordBytes > 8 * 1024 * 1024 || maximumRecordBytes > semanticDeepValueBytes) {
    throw new Error("deep semantic counts are inconsistent");
  }

  if (!Array.isArray(manifest.chunks) || manifest.chunks.length !== Object.keys(ENGINE_V2_CHUNKS).length) {
    throw new Error("manifest has an unexpected chunk count");
  }
  const seen = new Set<string>();
  const chunks = manifest.chunks.map((raw, index): EngineV2ChunkDescriptor => {
    const chunk = record(raw, `chunks[${index}]`);
    if (typeof chunk.file !== "string" || !(chunk.file in ENGINE_V2_CHUNKS) || seen.has(chunk.file)) {
      throw new Error(`unexpected or duplicate chunk ${String(chunk.file)}`);
    }
    seen.add(chunk.file);
    const file = chunk.file as EngineV2ChunkFile;
    const layout = ENGINE_V2_CHUNKS[file];
    const kind = integer(chunk.kind, `${file}.kind`);
    const sizeBytes = integer(chunk.sizeBytes, `${file}.sizeBytes`);
    const payloadBytes = integer(chunk.payloadBytes, `${file}.payloadBytes`);
    const recordCount = integer(chunk.recordCount, `${file}.recordCount`);
    const countValues = { ...counts, materialDefinitions, semanticRecords, semanticStringBytes,
      semanticDeepRecords, semanticDeepValueBytes };
    const expectedRecords = countValues[layout.count];
    if (kind !== layout.kind || recordCount !== expectedRecords) throw new Error(`${file} kind or record count is inconsistent`);
    if (payloadBytes !== recordCount * layout.stride || sizeBytes !== payloadBytes + 32) {
      throw new Error(`${file} length is inconsistent`);
    }
    if (typeof chunk.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(chunk.sha256)) {
      throw new Error(`${file} checksum is invalid`);
    }
    return { file, kind, sizeBytes, payloadBytes, recordCount, sha256: chunk.sha256 };
  });
  if (seen.size !== Object.keys(ENGINE_V2_CHUNKS).length) throw new Error("required Engine V2 chunks are missing");

  return {
    ...manifest,
    ...counts,
    recoveredDisjointFaces: recovered,
    format: ENGINE_V2_FORMAT,
    version: ENGINE_V2_MANIFEST_VERSION,
    engineVersion: ENGINE_V2_ENGINE_VERSION,
    complete: true,
    viewerReady: true,
    sourceSha256: manifest.sourceSha256 as string,
    coordinateSpace: "ifc-local-source-units",
    lengthUnitScaleToMetres: scale,
    sourceToViewerTransform: manifest.sourceToViewerTransform as number[],
    positionPolicy: ENGINE_V2_POSITION_POLICY,
    normalPolicy: ENGINE_V2_NORMAL_POLICY,
    materials: {
      status: "complete",
      assignmentPolicy: ENGINE_V2_MATERIAL_POLICY,
      materialDefinitions,
      instanceAssignments,
    },
    typeNames: manifest.typeNames as string[],
    semantic: {
      status: "complete",
      records: semanticRecords,
      parentLinks,
      roots,
      representedProducts,
      stringBytes: semanticStringBytes,
      deep: {
        status: "complete",
        records: semanticDeepRecords,
        productsWithRelations,
        relationEdges,
        valueBytes: semanticDeepValueBytes,
        maximumRecordBytes,
      },
    },
    chunks,
  };
}

export function engineV2Chunk(manifest: EngineV2Manifest, file: EngineV2ChunkFile): EngineV2ChunkDescriptor {
  const chunk = manifest.chunks.find((candidate) => candidate.file === file);
  if (!chunk) throw new Error(`missing Engine V2 chunk ${file}`);
  return chunk;
}
