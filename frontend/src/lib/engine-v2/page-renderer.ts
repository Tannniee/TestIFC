import * as THREE from "three";
import { SnappingClass } from "../viewer-native-types.ts";
import type { EngineV2Manifest } from "./manifest.ts";
import type { EngineV2PlannerClient } from "./planner-client.ts";
import type {
  EngineV2GeometryCluster,
  EngineV2PagePayload,
  EngineV2PlannerReady,
} from "./planner-contracts.ts";
import {
  DEFAULT_ENGINE_V2_PAGE_BUDGET,
  selectEngineV2Pages,
  type EngineV2PageBudget,
} from "./page-selector.ts";

interface DrawRef {
  mesh: THREE.BatchedMesh;
  batchId: number;
  original: THREE.Vector4;
}

interface ResidentPage {
  id: string;
  group: THREE.Group;
  meshes: THREE.BatchedMesh[];
  materials: THREE.Material[];
  productRefs: Map<number, DrawRef[]>;
  gpuBytes: number;
  diagnostics: Pick<EngineV2PagePayload, "sourceTriangles" | "rasterizedTriangles" | "sourceDegenerateTriangles" | "nonRasterizableTriangles">;
}

export interface EngineV2RenderBudgets extends EngineV2PageBudget {
  maximumPagePayloadBytes: number;
  frameUploadMilliseconds: number;
}

export interface EngineV2RendererHit {
  productId: number;
  point: THREE.Vector3;
  normal?: THREE.Vector3;
  object: THREE.Object3D;
  distance: number;
  ray: THREE.Ray;
  triangle?: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

const DEFAULT_RENDER_BUDGETS: EngineV2RenderBudgets = {
  ...DEFAULT_ENGINE_V2_PAGE_BUDGET,
  maximumPagePayloadBytes: 384 * 1024 * 1024,
  frameUploadMilliseconds: 8,
};

export class EngineV2PageRenderer {
  readonly object = new THREE.Group();
  readonly box: THREE.Box3;
  readonly productIds: Int32Array;
  readonly productTypeIds: Uint16Array;
  readonly productBounds: Float64Array;
  readonly diagnostics = { sourceTriangles: 0, rasterizedTriangles: 0, sourceDegenerateTriangles: 0, nonRasterizableTriangles: 0 };
  onChange: (() => void) | null = null;
  readonly plan: EngineV2PlannerReady;
  private readonly planner: EngineV2PlannerClient;
  private readonly budgets: EngineV2RenderBudgets;
  private readonly sourceToViewer: THREE.Matrix4;
  private readonly instanceColours: THREE.Vector4[];
  private readonly pages = new Map<string, ResidentPage>();
  private readonly productRefs = new Map<number, Set<DrawRef>>();
  private readonly hiddenProducts = new Set<number>();
  private readonly highlights = new Map<number, THREE.Vector4>();
  private readonly productIndex = new Map<number, number>();
  private readonly overview: THREE.LineSegments | null;
  private readonly overviewColours: THREE.BufferAttribute | null;
  private updateEpoch = 0;
  private updateAbort: AbortController | null = null;
  private disposed = false;
  private clippingPlanes: THREE.Plane[] = [];

  constructor(
    planner: EngineV2PlannerClient,
    manifest: EngineV2Manifest,
    plan: EngineV2PlannerReady,
    budgets: Partial<EngineV2RenderBudgets> = {},
  ) {
    this.planner = planner;
    this.plan = plan;
    this.budgets = { ...DEFAULT_RENDER_BUDGETS, ...budgets };
    this.sourceToViewer = new THREE.Matrix4().fromArray(manifest.sourceToViewerTransform);
    this.instanceColours = plan.materials.map(material => {
      // Interpret the stored RGB ratios as display colours to match the 1.0.3
      // viewer. BatchedMesh instance colours use Three.js's linear working space.
      const [red, green, blue, alpha] = material.rgba;
      const linear = new THREE.Color().setRGB(red, green, blue, THREE.SRGBColorSpace);
      return new THREE.Vector4(linear.r, linear.g, linear.b, alpha);
    });
    this.box = new THREE.Box3(
      new THREE.Vector3().fromArray(plan.modelBounds, 0),
      new THREE.Vector3().fromArray(plan.modelBounds, 3),
    );
    this.productIds = plan.productIds;
    this.productTypeIds = plan.productTypeIds;
    this.productBounds = plan.productBounds;
    for (let index = 0; index < this.productIds.length; index++) this.productIndex.set(this.productIds[index], index);
    this.object.name = "Engine V2 spatial pages";
    const overview = this.createOverview();
    this.overview = overview?.lines ?? null;
    this.overviewColours = overview?.colours ?? null;
    if (this.overview) this.object.add(this.overview);
  }

  private createOverview(): { lines: THREE.LineSegments; colours: THREE.BufferAttribute } | null {
    if (this.plan.expandedTriangles <= this.budgets.visibleTriangles ||
        this.plan.pages.length <= this.budgets.maximumPages) return null;
    const count = this.productIds.length;
    if (!count || count > 2_000_000) return null;
    const center = [0, 1, 2].map(axis =>
      (this.plan.modelBounds[axis] + this.plan.modelBounds[axis + 3]) / 2);
    const positions = new Float32Array(count * 6);
    const colors = new Float32Array(count * 8);
    for (let index = 0; index < count; index++) {
      const offset = index * 6;
      const colorOffset = index * 8;
      const material = this.instanceColours[this.plan.productMaterialOrdinals[index]];
      const base = material ?? new THREE.Vector4(0.4, 0.54, 0.7, 1);
      for (let axis = 0; axis < 3; axis++) {
        positions[offset + axis] = this.productBounds[offset + axis] - center[axis];
        positions[offset + axis + 3] = this.productBounds[offset + axis + 3] - center[axis];
        colors[colorOffset + axis] = base.getComponent(axis);
        colors[colorOffset + axis + 4] = base.getComponent(axis);
      }
      colors[colorOffset + 3] = 0.45;
      colors[colorOffset + 7] = 0.45;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colours = new THREE.BufferAttribute(colors, 4);
    geometry.setAttribute("color", colours);
    geometry.computeBoundingSphere();
    const material = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1,
      depthWrite: false, clippingPlanes: this.clippingPlanes,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = "Engine V2 complete model overview";
    lines.position.set(center[0], center[1], center[2]);
    lines.raycast = () => {};
    return { lines, colours };
  }

  private refreshOverviewColours(ids: number[]) {
    if (!this.overviewColours) return;
    const values = this.overviewColours.array as Float32Array;
    for (const id of ids) {
      const index = this.productIndex.get(id);
      if (index === undefined) continue;
      const offset = index * 8;
      const color = this.highlights.get(id);
      const base = this.instanceColours[this.plan.productMaterialOrdinals[index]];
      for (let axis = 0; axis < 3; axis++) {
        const value = color?.getComponent(axis) ?? base?.getComponent(axis) ?? [0.4, 0.54, 0.7][axis];
        values[offset + axis] = value;
        values[offset + axis + 4] = value;
      }
      const alpha = this.hiddenProducts.has(id) ? 0 : this.productRefs.has(id) ? 0.08 : color ? 0.9 : 0.45;
      values[offset + 3] = alpha;
      values[offset + 7] = alpha;
    }
    this.overviewColours.needsUpdate = true;
  }

  async update(camera: THREE.Camera, signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new DOMException("Engine V2 renderer disposed", "AbortError");
    this.updateAbort?.abort(new DOMException("Engine V2 camera update superseded", "AbortError"));
    const controller = new AbortController();
    this.updateAbort = controller;
    const forwardAbort = () => controller.abort(signal?.reason ?? new DOMException("Engine V2 page update cancelled", "AbortError"));
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const epoch = ++this.updateEpoch;
    try {
      const resident = new Set(this.pages.keys());
      const selected = selectEngineV2Pages(this.plan.pages, camera, resident, this.budgets);
      const selectedSet = new Set(selected);
      for (const id of [...this.pages.keys()]) if (!selectedSet.has(id)) this.unloadPage(id);
      for (const id of selected) {
        this.assertCurrent(epoch, controller.signal);
        if (this.pages.has(id)) continue;
        const payload = await this.planner.buildPage(id, controller.signal);
        this.assertCurrent(epoch, controller.signal);
        const payloadBytes = pagePayloadBytes(payload);
        if (payloadBytes > this.budgets.maximumPagePayloadBytes) {
          throw new Error(`Engine V2 page ${id} exceeds the CPU payload budget`);
        }
        let page: ResidentPage | null = null;
        try {
          page = await this.uploadPage(payload, epoch, controller.signal);
          this.assertCurrent(epoch, controller.signal);
          const residentGpuBytes = [...this.pages.values()].reduce((sum, value) => sum + value.gpuBytes, 0);
          if (residentGpuBytes + page.gpuBytes > this.budgets.estimatedGpuBytes) {
            throw new Error("Engine V2 resident pages exceed the GPU budget");
          }
          this.pages.set(id, page);
          this.object.add(page.group);
          for (const [productId, refs] of page.productRefs) {
            let target = this.productRefs.get(productId);
            if (!target) { target = new Set(); this.productRefs.set(productId, target); }
            for (const ref of refs) target.add(ref);
          }
          this.refreshOverviewColours([...page.productRefs.keys()]);
          this.addDiagnostics(page, 1);
          page = null;
          this.onChange?.();
        } finally {
          if (page) disposeResidentPage(page);
        }
      }
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      if (this.updateAbort === controller) this.updateAbort = null;
    }
  }

  setClippingPlanes(planes: THREE.Plane[]) {
    this.clippingPlanes = planes;
    if (this.overview) {
      const material = this.overview.material as THREE.LineBasicMaterial;
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
    for (const page of this.pages.values()) for (const material of page.materials) {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
  }

  cancelUpdate() {
    this.updateAbort?.abort(new DOMException("Engine V2 camera update superseded", "AbortError"));
  }

  setVisible(localIds: number[] | undefined, visible: boolean) {
    const ids = localIds ?? Array.from(this.productIndex.keys());
    for (const id of ids) {
      if (visible) this.hiddenProducts.delete(id); else this.hiddenProducts.add(id);
      for (const ref of this.productRefs.get(id) ?? []) ref.mesh.setVisibleAt(ref.batchId, visible);
    }
    this.refreshOverviewColours(ids);
    this.onChange?.();
  }

  highlight(localIds: number[] | undefined, color: THREE.Vector4) {
    const ids = localIds ?? Array.from(this.productIndex.keys());
    for (const id of ids) {
      this.highlights.set(id, color.clone());
      for (const ref of this.productRefs.get(id) ?? []) ref.mesh.setColorAt(ref.batchId, color);
    }
    this.refreshOverviewColours(ids);
    this.onChange?.();
  }

  resetHighlight(localIds?: number[]) {
    const ids = localIds ?? [...this.highlights.keys()];
    for (const id of ids) {
      this.highlights.delete(id);
      for (const ref of this.productRefs.get(id) ?? []) ref.mesh.setColorAt(ref.batchId, ref.original);
    }
    this.refreshOverviewColours(ids);
    this.onChange?.();
  }

  getMergedBox(localIds: number[]): THREE.Box3 {
    const result = new THREE.Box3();
    for (const id of localIds) {
      const index = this.productIndex.get(id);
      if (index === undefined) continue;
      const offset = index * 6;
      result.expandByPoint(new THREE.Vector3(this.productBounds[offset], this.productBounds[offset + 1], this.productBounds[offset + 2]));
      result.expandByPoint(new THREE.Vector3(this.productBounds[offset + 3], this.productBounds[offset + 4], this.productBounds[offset + 5]));
    }
    return result;
  }

  raycast(data: { camera: THREE.Camera; mouse: THREE.Vector2; dom: HTMLCanvasElement }): EngineV2RendererHit | null {
    const bounds = data.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((data.mouse.x - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
      -((data.mouse.y - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, data.camera);
    const hits = raycaster.intersectObjects([...this.pages.values()].flatMap(page => page.meshes), false);
    for (const hit of hits) {
      if (!(hit.object instanceof THREE.BatchedMesh) || hit.batchId === undefined) continue;
      const productId = (hit.object.userData.engineV2ProductIds as number[] | undefined)?.[hit.batchId];
      if (productId === undefined) continue;
      const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
      return {
        productId,
        point: hit.point.clone(),
        normal,
        object: hit.object,
        distance: hit.distance,
        ray: raycaster.ray.clone(),
        triangle: hit.face ? triangleWorldPoints(hit.object, hit.batchId, hit.face) : undefined,
      };
    }
    return null;
  }

  rectangleSelect(data: {
    camera: THREE.Camera;
    dom: HTMLCanvasElement;
    topLeft: THREE.Vector2;
    bottomRight: THREE.Vector2;
    fullyIncluded: boolean;
  }): number[] {
    data.camera.updateMatrixWorld();
    const viewport = data.dom.getBoundingClientRect();
    const selected: number[] = [];
    for (const id of this.productRefs.keys()) {
      if (this.hiddenProducts.has(id)) continue;
      const box = this.getMergedBox([id]);
      const screen = projectedBox(box, data.camera, viewport);
      if (!screen) continue;
      const intersects = screen.maxX >= data.topLeft.x && screen.minX <= data.bottomRight.x
        && screen.maxY >= data.topLeft.y && screen.minY <= data.bottomRight.y;
      const included = screen.minX >= data.topLeft.x && screen.maxX <= data.bottomRight.x
        && screen.minY >= data.topLeft.y && screen.maxY <= data.bottomRight.y;
      if (data.fullyIncluded ? included : intersects) selected.push(id);
    }
    return selected;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.updateAbort?.abort(new DOMException("Engine V2 renderer disposed", "AbortError"));
    this.updateAbort = null;
    this.updateEpoch++;
    for (const id of [...this.pages.keys()]) this.unloadPage(id);
    if (this.overview) {
      this.overview.removeFromParent();
      this.overview.geometry.dispose();
      (this.overview.material as THREE.Material).dispose();
    }
    this.productRefs.clear();
    this.object.removeFromParent();
  }

  private async uploadPage(payload: EngineV2PagePayload, epoch: number, signal?: AbortSignal): Promise<ResidentPage> {
    const group = new THREE.Group();
    group.name = `Engine V2 page ${payload.pageId}`;
    const productRefs = new Map<number, DrawRef[]>();
    const meshes: THREE.BatchedMesh[] = [];
    const materials: THREE.Material[] = [];
    const clustersByBase = new Map<number, EngineV2GeometryCluster[]>();
    for (const cluster of payload.clusters) {
      const list = clustersByBase.get(cluster.baseId) ?? [];
      list.push(cluster); clustersByBase.set(cluster.baseId, list);
    }
    let gpuBytes = 0;
    try {
      for (const transparent of [false, true]) {
        const instances = payload.instances.filter(instance => this.materialTransparent(instance.materialOrdinal) === transparent);
        if (!instances.length) continue;
        const baseIds = new Set(instances.map(instance => instance.baseId));
        const clusters = payload.clusters.filter(cluster => baseIds.has(cluster.baseId) && cluster.positions.length > 0);
        const maxInstances = instances.reduce((sum, instance) => sum + (clustersByBase.get(instance.baseId)?.length ?? 0), 0);
        const maxVertices = clusters.reduce((sum, cluster) => sum + cluster.positions.length / 3, 0);
        const maxIndices = clusters.reduce((sum, cluster) => sum + cluster.indices.length, 0);
        if (!maxInstances || !maxVertices || !maxIndices) continue;
        const material = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          transparent,
          opacity: 1,
          depthWrite: !transparent,
          clippingPlanes: this.clippingPlanes,
        });
        const batched = new THREE.BatchedMesh(maxInstances, maxVertices, maxIndices, material);
        group.add(batched); meshes.push(batched); materials.push(material);
        const batchProductIds: number[] = [];
        batched.userData.engineV2ProductIds = batchProductIds;
        batched.perObjectFrustumCulled = true;
        batched.sortObjects = transparent;
        const geometryIds = new Map<string, number>();
        let lastYield = performance.now();
        for (const cluster of clusters) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(cluster.positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(cluster.normals, 3));
          geometry.setIndex(new THREE.BufferAttribute(cluster.indices, 1));
          geometry.computeBoundingBox(); geometry.computeBoundingSphere();
          geometryIds.set(clusterKey(cluster), batched.addGeometry(geometry));
          geometry.dispose();
          lastYield = await this.yieldIfNeeded(lastYield, epoch, signal);
        }
        const matrix = new THREE.Matrix4(), source = new THREE.Matrix4(), translation = new THREE.Matrix4();
        for (const instance of instances) {
          source.fromArray(instanceMatrix16(instance.matrix));
          const original = this.instanceColours[instance.materialOrdinal];
          if (!original) throw new Error(`Engine V2 material ${instance.materialOrdinal} is missing`);
          for (const cluster of clustersByBase.get(instance.baseId) ?? []) {
            if (!cluster.positions.length) continue;
            const geometryId = geometryIds.get(clusterKey(cluster));
            if (geometryId === undefined) continue;
            const batchId = batched.addInstance(geometryId);
            batchProductIds[batchId] = instance.productId;
            translation.makeTranslation(...cluster.origin);
            matrix.copy(this.sourceToViewer).multiply(source).multiply(translation);
            batched.setMatrixAt(batchId, matrix);
            batched.setColorAt(batchId, this.highlights.get(instance.productId) ?? original);
            batched.setVisibleAt(batchId, !this.hiddenProducts.has(instance.productId));
            const ref = { mesh: batched, batchId, original };
            const refs = productRefs.get(instance.productId) ?? [];
            refs.push(ref); productRefs.set(instance.productId, refs);
          }
          lastYield = await this.yieldIfNeeded(lastYield, epoch, signal);
        }
        batched.computeBoundingBox(); batched.computeBoundingSphere();
        gpuBytes += maxVertices * 24 + maxIndices * 4 + maxInstances * 84;
      }
      if (gpuBytes > this.budgets.estimatedGpuBytes) throw new Error(`Engine V2 page ${payload.pageId} exceeds the GPU budget`);
      return {
        id: payload.pageId,
        group,
        meshes,
        materials,
        productRefs,
        gpuBytes,
        diagnostics: {
          sourceTriangles: payload.sourceTriangles,
          rasterizedTriangles: payload.rasterizedTriangles,
          sourceDegenerateTriangles: payload.sourceDegenerateTriangles,
          nonRasterizableTriangles: payload.nonRasterizableTriangles,
        },
      };
    } catch (error) {
      for (const mesh of meshes) mesh.dispose();
      for (const material of materials) material.dispose();
      group.clear();
      throw error;
    }
  }

  private materialTransparent(ordinal: number) {
    const material = this.plan.materials[ordinal];
    if (!material) throw new Error(`Engine V2 material ${ordinal} is missing`);
    return Boolean(material.flags & 2) || material.rgba[3] < 0.9999;
  }

  private async yieldIfNeeded(lastYield: number, epoch: number, signal?: AbortSignal) {
    if (performance.now() - lastYield < this.budgets.frameUploadMilliseconds) return lastYield;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    this.assertCurrent(epoch, signal);
    return performance.now();
  }

  private unloadPage(id: string) {
    const page = this.pages.get(id);
    if (!page) return;
    this.pages.delete(id);
    page.group.removeFromParent();
    for (const [productId, refs] of page.productRefs) {
      const target = this.productRefs.get(productId);
      if (!target) continue;
      for (const ref of refs) target.delete(ref);
      if (!target.size) this.productRefs.delete(productId);
    }
    this.refreshOverviewColours([...page.productRefs.keys()]);
    disposeResidentPage(page);
    this.addDiagnostics(page, -1);
    this.onChange?.();
  }

  private addDiagnostics(page: ResidentPage, direction: 1 | -1) {
    for (const key of Object.keys(this.diagnostics) as Array<keyof typeof this.diagnostics>) {
      this.diagnostics[key] += page.diagnostics[key] * direction;
    }
  }

  private assertCurrent(epoch: number, signal?: AbortSignal) {
    if (this.disposed || epoch !== this.updateEpoch || signal?.aborted) {
      throw signal?.reason ?? new DOMException("Engine V2 page update cancelled", "AbortError");
    }
  }
}

function clusterKey(cluster: EngineV2GeometryCluster) {
  return `${cluster.baseId}:${cluster.clusterId}`;
}

function instanceMatrix16(values: ArrayLike<number>): number[] {
  return [
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    values[9], values[10], values[11], 1,
  ];
}

function pagePayloadBytes(payload: EngineV2PagePayload) {
  return payload.clusters.reduce((sum, cluster) => sum + cluster.positions.byteLength + cluster.normals.byteLength + cluster.indices.byteLength, 0)
    + payload.instances.reduce((sum, instance) => sum + instance.matrix.byteLength + 64, 0);
}

function triangleWorldPoints(object: THREE.BatchedMesh, batchId: number, face: { a: number; b: number; c: number }): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const position = object.geometry.getAttribute("position");
  const batch = object.getMatrixAt(batchId, new THREE.Matrix4()).premultiply(object.matrixWorld);
  return [face.a, face.b, face.c].map(index => new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(batch)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

function projectedBox(box: THREE.Box3, camera: THREE.Camera, viewport: DOMRect) {
  const values = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let mask = 0; mask < 8; mask++) {
    const point = new THREE.Vector3(
      (mask & 1) ? box.max.x : box.min.x,
      (mask & 2) ? box.max.y : box.min.y,
      (mask & 4) ? box.max.z : box.min.z,
    ).project(camera);
    if (![point.x, point.y, point.z].every(Number.isFinite)) return null;
    const x = viewport.left + (point.x + 1) * 0.5 * viewport.width;
    const y = viewport.top + (1 - point.y) * 0.5 * viewport.height;
    values.minX = Math.min(values.minX, x); values.maxX = Math.max(values.maxX, x);
    values.minY = Math.min(values.minY, y); values.maxY = Math.max(values.maxY, y);
  }
  return values;
}

export { SnappingClass };

function disposeResidentPage(page: ResidentPage) {
  page.group.removeFromParent();
  for (const mesh of page.meshes) mesh.dispose();
  for (const material of page.materials) material.dispose();
  page.group.clear();
}
