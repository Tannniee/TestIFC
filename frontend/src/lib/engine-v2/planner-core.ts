import { EngineV2BinaryTables, type EngineV2MeshRecord, type EngineV2ProductRecord } from "./binary-tables.ts";
import {
  DEFAULT_ENGINE_V2_PLANNER_OPTIONS,
  type EngineV2GeometryCluster,
  type EngineV2PageInstance,
  type EngineV2PagePayload,
  type EngineV2PageSummary,
  type EngineV2PlannerOptions,
  type EngineV2PlannerReady,
} from "./planner-contracts.ts";

interface PlannerHooks {
  cancelled(): boolean;
  yieldControl(): Promise<void>;
}

interface PageBuilder {
  id: string;
  bounds: number[];
  instanceOrdinals: number[];
  triangles: number;
}

interface ClusterRange {
  firstTriangle: number;
  triangleCount: number;
  bounds: number[];
}

const MAXIMUM_CACHED_CLUSTER_BYTES = 64 * 1024 * 1024;

function cloneCluster(cluster: EngineV2GeometryCluster): EngineV2GeometryCluster {
  return {
    ...cluster,
    origin: [...cluster.origin],
    positions: cluster.positions.slice(),
    normals: cluster.normals.slice(),
    indices: cluster.indices.slice(),
  };
}

const emptyBounds = () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

function includePoint(bounds: number[], x: number, y: number, z: number) {
  bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.min(bounds[2], z);
  bounds[3] = Math.max(bounds[3], x); bounds[4] = Math.max(bounds[4], y); bounds[5] = Math.max(bounds[5], z);
}

function includeBounds(target: number[], source: ArrayLike<number>) {
  includePoint(target, source[0], source[1], source[2]);
  includePoint(target, source[3], source[4], source[5]);
}

function multiply4(left: ArrayLike<number>, right: ArrayLike<number>): Float64Array {
  const result = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let index = 0; index < 4; index++) value += left[index * 4 + row] * right[column * 4 + index];
      result[column * 4 + row] = value;
    }
  }
  return result;
}

function instanceMatrix(values: ArrayLike<number>): Float64Array {
  return new Float64Array([
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    values[9], values[10], values[11], 1,
  ]);
}

function transformPoint(matrix: ArrayLike<number>, x: number, y: number, z: number, target: number[]) {
  target[0] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  target[1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  target[2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
}

function transformBounds(source: ArrayLike<number>, matrix: ArrayLike<number>): number[] {
  const result = emptyBounds();
  const point = [0, 0, 0];
  for (let mask = 0; mask < 8; mask++) {
    transformPoint(
      matrix,
      source[(mask & 1) ? 3 : 0],
      source[(mask & 2) ? 4 : 1],
      source[(mask & 4) ? 5 : 2],
      point,
    );
    includePoint(result, point[0], point[1], point[2]);
  }
  return result;
}

function crossLengthSquared(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  return x * x + y * y + z * z;
}

function decodeOctahedral(xValue: number, yValue: number): [number, number, number] {
  let x = Math.max(-1, xValue / 32767);
  let y = Math.max(-1, yValue / 32767);
  let z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const oldX = x;
    x = (1 - Math.abs(y)) * (oldX < 0 ? -1 : 1);
    y = (1 - Math.abs(oldX)) * (y < 0 ? -1 : 1);
  }
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function finiteBounds(bounds: number[]): bounds is [number, number, number, number, number, number] {
  return bounds.length === 6 && bounds.every(Number.isFinite) && bounds[0] <= bounds[3] && bounds[1] <= bounds[4] && bounds[2] <= bounds[5];
}

export class EngineV2PlannerCore {
  private readonly tables: EngineV2BinaryTables;
  private readonly hooks: PlannerHooks;
  private readonly options: EngineV2PlannerOptions;
  private readonly sourceToViewer: Float64Array;
  private readonly meshes = new Map<number, EngineV2MeshRecord>();
  private readonly pages = new Map<string, PageBuilder>();
  private readonly pageShards = new Map<string, PageBuilder[]>();
  private readonly clusterRanges = new Map<number, ClusterRange[]>();
  private readonly clusterCache = new Map<number, { clusters: EngineV2GeometryCluster[]; bytes: number }>();
  private cachedClusterBytes = 0;
  private readonly products: EngineV2ProductRecord[] = [];
  private productIds = new Int32Array();
  private productTypeIds = new Uint16Array();
  private productMaterialOrdinals = new Uint32Array();
  private productBounds = new Float64Array();
  private ready: EngineV2PlannerReady | null = null;

  constructor(
    tables: EngineV2BinaryTables,
    options: Partial<EngineV2PlannerOptions> = {},
    hooks: PlannerHooks = { cancelled: () => false, yieldControl: async () => {} },
  ) {
    this.tables = tables;
    this.hooks = hooks;
    this.options = { ...DEFAULT_ENGINE_V2_PLANNER_OPTIONS, ...options };
    if (this.options.pageSizeMetres <= 0 || this.options.maximumPageTriangles <= 0 || this.options.maximumClusterSpanMetres <= 0
      || this.options.maximumClusterTriangles <= 0 || this.options.yieldEvery <= 0) {
      throw new Error("Engine V2 planner budgets must be positive");
    }
    this.sourceToViewer = new Float64Array(tables.artifact.manifest.sourceToViewerTransform);
  }

  async initialize(): Promise<EngineV2PlannerReady> {
    if (this.ready) return this.ready;
    const { manifest } = this.tables.artifact;
    let baseTriangles = 0;
    for (let index = 0; index < manifest.baseDefinitions; index++) {
      const mesh = this.tables.mesh(index);
      if (mesh.indexCount <= 0 || mesh.indexCount % 3 || mesh.firstIndex + mesh.indexCount > manifest.indices) {
        throw new Error(`Engine V2 mesh #${mesh.baseId} has an invalid index range`);
      }
      if (this.meshes.has(mesh.baseId)) throw new Error(`Engine V2 mesh #${mesh.baseId} is duplicated`);
      this.meshes.set(mesh.baseId, mesh);
      baseTriangles += mesh.indexCount / 3;
    }
    if (baseTriangles !== manifest.triangles) throw new Error("Engine V2 base-triangle coverage does not match the manifest");

    this.productIds = new Int32Array(manifest.products);
    this.productTypeIds = new Uint16Array(manifest.products);
    this.productMaterialOrdinals = new Uint32Array(manifest.products);
    this.productBounds = new Float64Array(manifest.products * 6);
    this.productBounds.fill(Infinity);
    for (let index = 0; index < manifest.products; index++) {
      const product = this.tables.product(index);
      this.products.push(product);
      if (product.firstInstance + product.instanceCount > manifest.instances || product.instanceCount <= 0) {
        throw new Error(`Engine V2 product #${product.productId} has an invalid instance range`);
      }
      this.productIds[index] = product.productId;
      this.productTypeIds[index] = product.typeId;
      this.productMaterialOrdinals[index] = this.tables.instanceMaterials[product.firstInstance];
      this.productBounds[index * 6 + 3] = -Infinity;
      this.productBounds[index * 6 + 4] = -Infinity;
      this.productBounds[index * 6 + 5] = -Infinity;
    }

    const modelBounds = emptyBounds();
    let expandedTriangles = 0;
    let productIndex = 0;
    const matrix = new Float64Array(12);
    for (let ordinal = 0; ordinal < manifest.instances; ordinal++) {
      await this.checkpoint(ordinal);
      const instance = this.tables.instance(ordinal, matrix);
      while (productIndex + 1 < manifest.products
        && ordinal >= this.products[productIndex].firstInstance + this.products[productIndex].instanceCount) productIndex++;
      const product = this.products[productIndex];
      if (product.productId !== instance.productId || ordinal < product.firstInstance || ordinal >= product.firstInstance + product.instanceCount) {
        throw new Error(`Engine V2 instance ${ordinal} falls outside product #${instance.productId}`);
      }
      const mesh = this.meshes.get(instance.baseId);
      if (!mesh) throw new Error(`Engine V2 instance ${ordinal} references missing mesh #${instance.baseId}`);
      const world = multiply4(this.sourceToViewer, instanceMatrix(instance.matrix));
      const bounds = transformBounds(mesh.bounds, world);
      if (!finiteBounds(bounds)) throw new Error(`Engine V2 instance ${ordinal} has invalid world bounds`);
      includeBounds(modelBounds, bounds);
      const productOffset = productIndex * 6;
      includeBoundsAt(this.productBounds, productOffset, bounds);
      const centerX = (bounds[0] + bounds[3]) * 0.5;
      const centerY = (bounds[1] + bounds[4]) * 0.5;
      const centerZ = (bounds[2] + bounds[5]) * 0.5;
      const cell = `${Math.floor(centerX / this.options.pageSizeMetres)}:${Math.floor(centerY / this.options.pageSizeMetres)}:${Math.floor(centerZ / this.options.pageSizeMetres)}`;
      const triangles = mesh.indexCount / 3;
      let shards = this.pageShards.get(cell);
      if (!shards) { shards = []; this.pageShards.set(cell, shards); }
      let page = shards.at(-1);
      if (!page || (page.triangles > 0 && page.triangles + triangles > this.options.maximumPageTriangles)) {
        const id = `${cell}:${shards.length}`;
        page = { id, bounds: emptyBounds(), instanceOrdinals: [], triangles: 0 };
        shards.push(page);
        this.pages.set(id, page);
      }
      page.instanceOrdinals.push(ordinal);
      includeBounds(page.bounds, bounds);
      page.triangles += triangles;
      expandedTriangles += triangles;
    }
    if (expandedTriangles !== manifest.expandedTriangles) throw new Error("Engine V2 expanded-triangle coverage does not match the manifest");
    if (!finiteBounds(modelBounds)) throw new Error("Engine V2 model bounds are empty");
    for (let index = 0; index < manifest.products; index++) {
      const values = Array.from(this.productBounds.subarray(index * 6, index * 6 + 6));
      if (!finiteBounds(values)) throw new Error(`Engine V2 product #${this.productIds[index]} has empty bounds`);
    }

    const pages: EngineV2PageSummary[] = [...this.pages.values()].map(page => ({
      id: page.id,
      bounds: page.bounds as EngineV2PageSummary["bounds"],
      instances: page.instanceOrdinals.length,
      triangles: page.triangles,
    }));
    const materials = Array.from({ length: manifest.materials.materialDefinitions }, (_, index) => this.tables.material(index));
    this.ready = {
      pages,
      modelBounds: modelBounds as EngineV2PlannerReady["modelBounds"],
      materials,
      productIds: this.productIds,
      productTypeIds: this.productTypeIds,
      productMaterialOrdinals: this.productMaterialOrdinals,
      productBounds: this.productBounds,
      baseTriangles,
      expandedTriangles,
    };
    return this.ready;
  }

  async buildPage(pageId: string): Promise<EngineV2PagePayload> {
    await this.initialize();
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Unknown Engine V2 page ${pageId}`);
    const instances: EngineV2PageInstance[] = [];
    const baseIds = new Set<number>();
    const matrix = new Float64Array(12);
    for (let index = 0; index < page.instanceOrdinals.length; index++) {
      await this.checkpoint(index);
      const ordinal = page.instanceOrdinals[index];
      const instance = this.tables.instance(ordinal, matrix);
      const mesh = this.meshes.get(instance.baseId)!;
      const world = multiply4(this.sourceToViewer, instanceMatrix(instance.matrix));
      instances.push({
        ordinal,
        productId: instance.productId,
        baseId: instance.baseId,
        materialOrdinal: this.tables.instanceMaterials[ordinal],
        matrix: new Float64Array(instance.matrix),
        bounds: transformBounds(mesh.bounds, world) as EngineV2PageInstance["bounds"],
      });
      baseIds.add(instance.baseId);
    }

    const clusters: EngineV2GeometryCluster[] = [];
    const diagnostics = new Map<number, { source: number; degenerate: number; failed: number }>();
    for (const baseId of baseIds) {
      const built = await this.buildClusters(this.meshes.get(baseId)!);
      clusters.push(...built);
      diagnostics.set(baseId, {
        source: built.reduce((sum, cluster) => sum + cluster.sourceTriangles, 0),
        degenerate: built.reduce((sum, cluster) => sum + cluster.sourceDegenerateTriangles, 0),
        failed: built.reduce((sum, cluster) => sum + cluster.nonRasterizableTriangles, 0),
      });
    }
    let sourceTriangles = 0, sourceDegenerateTriangles = 0, nonRasterizableTriangles = 0;
    for (const instance of instances) {
      const values = diagnostics.get(instance.baseId)!;
      sourceTriangles += values.source;
      sourceDegenerateTriangles += values.degenerate;
      nonRasterizableTriangles += values.failed;
    }
    return {
      pageId,
      clusters,
      instances,
      sourceTriangles,
      rasterizedTriangles: sourceTriangles - sourceDegenerateTriangles - nonRasterizableTriangles,
      sourceDegenerateTriangles,
      nonRasterizableTriangles,
    };
  }

  private async buildClusters(mesh: EngineV2MeshRecord): Promise<EngineV2GeometryCluster[]> {
    const cached = this.clusterCache.get(mesh.baseId);
    if (cached) {
      this.clusterCache.delete(mesh.baseId);
      this.clusterCache.set(mesh.baseId, cached);
      return cached.clusters.map(cloneCluster);
    }
    let ranges = this.clusterRanges.get(mesh.baseId);
    if (!ranges) {
      ranges = await this.planClusterRanges(mesh);
      this.clusterRanges.set(mesh.baseId, ranges);
    }
    const result: EngineV2GeometryCluster[] = [];
    for (let index = 0; index < ranges.length; index++) {
      const clusters = await this.materializeRange(mesh, index, ranges[index]);
      result.push(...clusters);
    }
    const bytes = result.reduce((sum, cluster) =>
      sum + cluster.positions.byteLength + cluster.normals.byteLength + cluster.indices.byteLength, 0);
    if (bytes <= MAXIMUM_CACHED_CLUSTER_BYTES) {
      while (this.cachedClusterBytes + bytes > MAXIMUM_CACHED_CLUSTER_BYTES) {
        const oldestId = this.clusterCache.keys().next().value;
        if (oldestId === undefined) break;
        const oldest = this.clusterCache.get(oldestId)!;
        this.clusterCache.delete(oldestId);
        this.cachedClusterBytes -= oldest.bytes;
      }
      this.clusterCache.set(mesh.baseId, { clusters: result, bytes });
      this.cachedClusterBytes += bytes;
      // The worker transfers page buffers; cached arrays must keep their own backing storage.
      return result.map(cloneCluster);
    }
    return result;
  }

  private async planClusterRanges(mesh: EngineV2MeshRecord): Promise<ClusterRange[]> {
    const maximumSpanSource = this.options.maximumClusterSpanMetres / this.tables.artifact.manifest.lengthUnitScaleToMetres;
    const triangleCount = mesh.indexCount / 3;
    const ranges: ClusterRange[] = [];
    let first = 0, count = 0, bounds = emptyBounds();
    const point = new Float64Array(3);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      await this.checkpoint(triangle);
      const candidate = [...bounds];
      for (let corner = 0; corner < 3; corner++) {
        this.tables.position(this.tables.indices[mesh.firstIndex + triangle * 3 + corner], point);
        includePoint(candidate, point[0], point[1], point[2]);
      }
      const span = Math.max(candidate[3] - candidate[0], candidate[4] - candidate[1], candidate[5] - candidate[2]);
      if (count && (count >= this.options.maximumClusterTriangles || span > maximumSpanSource)) {
        ranges.push({ firstTriangle: first, triangleCount: count, bounds });
        first = triangle; count = 0; bounds = emptyBounds();
        for (let corner = 0; corner < 3; corner++) {
          this.tables.position(this.tables.indices[mesh.firstIndex + triangle * 3 + corner], point);
          includePoint(bounds, point[0], point[1], point[2]);
        }
      } else {
        bounds = candidate;
      }
      count++;
    }
    if (count) ranges.push({ firstTriangle: first, triangleCount: count, bounds });
    return ranges;
  }

  private async materializeRange(mesh: EngineV2MeshRecord, clusterId: number, range: ClusterRange): Promise<EngineV2GeometryCluster[]> {
    const origin: [number, number, number] = [
      (range.bounds[0] + range.bounds[3]) * 0.5,
      (range.bounds[1] + range.bounds[4]) * 0.5,
      (range.bounds[2] + range.bounds[5]) * 0.5,
    ];
    const positions: number[] = [], normals: number[] = [], indices: number[] = [];
    const vertexMap = new Map<string, number>();
    const special: EngineV2GeometryCluster[] = [];
    let sourceDegenerate = 0, failed = 0, uploaded = 0;
    const points = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
    for (let localTriangle = 0; localTriangle < range.triangleCount; localTriangle++) {
      await this.checkpoint(localTriangle);
      const triangle = range.firstTriangle + localTriangle;
      const ordinals = [0, 0, 0];
      for (let corner = 0; corner < 3; corner++) {
        const ordinal = this.tables.indices[mesh.firstIndex + triangle * 3 + corner];
        ordinals[corner] = ordinal;
        this.tables.position(ordinal, points[corner]);
      }
      const sourceArea = crossLengthSquared(points[0], points[1], points[2]);
      if (sourceArea === 0) sourceDegenerate++;
      const isolatedLocal = points.map(point => [
        Math.fround(point[0] - points[0][0]), Math.fround(point[1] - points[0][1]), Math.fround(point[2] - points[0][2]),
      ]);
      // A wider cluster origin can introduce a false, rounding-created area.
      // The per-triangle origin is the precision gate recorded by the P3 ledger.
      if (sourceArea > 0 && crossLengthSquared(isolatedLocal[0], isolatedLocal[1], isolatedLocal[2]) === 0) {
        failed++;
        continue;
      }
      const local = points.map(point => [
        Math.fround(point[0] - origin[0]), Math.fround(point[1] - origin[1]), Math.fround(point[2] - origin[2]),
      ]);
      if (sourceArea > 0 && crossLengthSquared(local[0], local[1], local[2]) === 0) {
        const isolated = this.materializeIsolatedTriangle(mesh, -(triangle + 1), triangle, points);
        if (isolated) special.push(isolated);
        else failed++;
        continue;
      }
      const normalOffset = (mesh.firstIndex / 3 + triangle) * 2;
      const packedX = this.tables.normals[normalOffset], packedY = this.tables.normals[normalOffset + 1];
      const normal = decodeOctahedral(packedX, packedY);
      for (let corner = 0; corner < 3; corner++) {
        const key = `${ordinals[corner]}/${packedX}/${packedY}`;
        let vertex = vertexMap.get(key);
        if (vertex === undefined) {
          vertex = positions.length / 3;
          vertexMap.set(key, vertex);
          positions.push(...local[corner]);
          normals.push(...normal);
        }
        indices.push(vertex);
      }
      uploaded++;
    }
    const main: EngineV2GeometryCluster[] = positions.length || failed ? [{
      baseId: mesh.baseId,
      clusterId,
      origin,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      sourceTriangles: range.triangleCount - special.length,
      rasterizedTriangles: uploaded - sourceDegenerate,
      sourceDegenerateTriangles: sourceDegenerate,
      nonRasterizableTriangles: failed,
    }] : [];
    return [...main, ...special];
  }

  private materializeIsolatedTriangle(
    mesh: EngineV2MeshRecord,
    clusterId: number,
    triangle: number,
    points: Float64Array[],
  ): EngineV2GeometryCluster | null {
    const origin: [number, number, number] = [points[0][0], points[0][1], points[0][2]];
    const local = points.map(point => [
      Math.fround(point[0] - origin[0]), Math.fround(point[1] - origin[1]), Math.fround(point[2] - origin[2]),
    ]);
    if (crossLengthSquared(local[0], local[1], local[2]) === 0) return null;
    const normalOffset = (mesh.firstIndex / 3 + triangle) * 2;
    const normal = decodeOctahedral(this.tables.normals[normalOffset], this.tables.normals[normalOffset + 1]);
    return {
      baseId: mesh.baseId,
      clusterId,
      origin,
      positions: new Float32Array(local.flat()),
      normals: new Float32Array([...normal, ...normal, ...normal]),
      indices: new Uint32Array([0, 1, 2]),
      sourceTriangles: 1,
      rasterizedTriangles: 1,
      sourceDegenerateTriangles: 0,
      nonRasterizableTriangles: 0,
    };
  }

  private async checkpoint(iteration: number) {
    if (this.hooks.cancelled()) throw new DOMException("Engine V2 planning cancelled", "AbortError");
    if (iteration > 0 && iteration % this.options.yieldEvery === 0) {
      await this.hooks.yieldControl();
      if (this.hooks.cancelled()) throw new DOMException("Engine V2 planning cancelled", "AbortError");
    }
  }
}

function includeBoundsAt(target: Float64Array, offset: number, source: ArrayLike<number>) {
  target[offset] = Math.min(target[offset], source[0]);
  target[offset + 1] = Math.min(target[offset + 1], source[1]);
  target[offset + 2] = Math.min(target[offset + 2], source[2]);
  target[offset + 3] = Math.max(target[offset + 3], source[3]);
  target[offset + 4] = Math.max(target[offset + 4], source[4]);
  target[offset + 5] = Math.max(target[offset + 5], source[5]);
}
