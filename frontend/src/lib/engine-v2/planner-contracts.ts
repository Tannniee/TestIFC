import type { EngineV2MaterialRecord } from "./binary-tables.ts";

export interface EngineV2PlannerOptions {
  pageSizeMetres: number;
  maximumPageTriangles: number;
  maximumClusterSpanMetres: number;
  maximumClusterTriangles: number;
  yieldEvery: number;
}

export const DEFAULT_ENGINE_V2_PLANNER_OPTIONS: EngineV2PlannerOptions = {
  pageSizeMetres: 40,
  maximumPageTriangles: 1_000_000,
  maximumClusterSpanMetres: 25,
  maximumClusterTriangles: 32_768,
  yieldEvery: 8_192,
};

export interface EngineV2PageSummary {
  id: string;
  bounds: [number, number, number, number, number, number];
  instances: number;
  triangles: number;
}

export interface EngineV2PlannerReady {
  pages: EngineV2PageSummary[];
  modelBounds: [number, number, number, number, number, number];
  materials: EngineV2MaterialRecord[];
  productIds: Int32Array;
  productTypeIds: Uint16Array;
  productMaterialOrdinals: Uint32Array;
  productBounds: Float64Array;
  baseTriangles: number;
  expandedTriangles: number;
}

export interface EngineV2GeometryCluster {
  baseId: number;
  clusterId: number;
  origin: [number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  sourceTriangles: number;
  rasterizedTriangles: number;
  sourceDegenerateTriangles: number;
  nonRasterizableTriangles: number;
}

export interface EngineV2PageInstance {
  ordinal: number;
  productId: number;
  baseId: number;
  materialOrdinal: number;
  matrix: Float64Array;
  bounds: [number, number, number, number, number, number];
}

export interface EngineV2PagePayload {
  pageId: string;
  clusters: EngineV2GeometryCluster[];
  instances: EngineV2PageInstance[];
  sourceTriangles: number;
  rasterizedTriangles: number;
  sourceDegenerateTriangles: number;
  nonRasterizableTriangles: number;
}
