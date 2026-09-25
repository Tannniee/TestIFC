import { SnappingClass, type ItemData, type SpatialTreeItem } from "../viewer-native-types.ts";
import * as THREE from "three";
import type { EngineV2ArtifactBuffers } from "./artifact-reader.ts";
import type { EngineV2Manifest } from "./manifest.ts";
import { EngineV2PlannerClient } from "./planner-client.ts";
import { EngineV2PageRenderer, type EngineV2RenderBudgets, type EngineV2RendererHit } from "./page-renderer.ts";
import type { EngineV2PlannerOptions } from "./planner-contracts.ts";
import type {
  ViewerHighlightMaterial,
  ViewerModel,
  ViewerRaycastData,
  ViewerRaycastResult,
  ViewerRectangleRaycastData,
  ViewerRectangleRaycastResult,
  ViewerSnappingRaycastData,
} from "../viewer-model-contract.ts";
import { ViewerModelSignal } from "../viewer-model-contract.ts";

export interface EngineV2SemanticSource {
  getSpatialStructure?(): Promise<SpatialTreeItem>;
  getLocalIdsByGuids?(guids: string[]): Promise<(number | null)[]>;
  getItemsOfCategories?(categories: RegExp[]): Promise<Record<string, number[]>>;
  getGuids?(): Promise<string[]>;
  getGuidsByLocalIds?(localIds: number[]): Promise<(string | null)[]>;
  getItemsData?(ids: number[], config?: Record<string, unknown>): Promise<ItemData[]>;
  dispose?(): void;
}

export interface EngineV2ModelOptions {
  planner?: Partial<EngineV2PlannerOptions>;
  renderer?: Partial<EngineV2RenderBudgets>;
  semantic?: EngineV2SemanticSource;
}

/** Transactional Engine V2 model with renderer-neutral geometry and semantic adapters. */
export class EngineV2Model implements ViewerModel {
  readonly engine = "engine-v2" as const;
  readonly onViewUpdated = new ViewerModelSignal();
  readonly object: THREE.Object3D;
  readonly box: THREE.Box3;
  frozen = true;
  getClippingPlanesEvent: () => THREE.Plane[] = () => [];
  private readonly sourceToViewer: THREE.Matrix4;
  private disposed = false;

  constructor(
    readonly modelId: string,
    private readonly planner: EngineV2PlannerClient,
    private readonly renderer: EngineV2PageRenderer,
    manifest: EngineV2Manifest,
    private readonly semantic?: EngineV2SemanticSource,
  ) {
    this.object = renderer.object;
    this.box = renderer.box;
    this.sourceToViewer = new THREE.Matrix4().fromArray(manifest.sourceToViewerTransform);
    renderer.onChange = () => this.onViewUpdated.emit(this);
  }

  async update(camera: THREE.Camera, signal?: AbortSignal) {
    if (this.frozen || this.disposed) return;
    this.renderer.setClippingPlanes(this.getClippingPlanesEvent());
    await this.renderer.update(camera, signal);
  }

  cancelUpdate() { this.renderer.cancelUpdate(); }

  async prime(signal?: AbortSignal) {
    if (this.disposed || this.box.isEmpty()) return;
    const center = this.box.getCenter(new THREE.Vector3());
    const size = this.box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1);
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 8);
    camera.position.copy(center).add(new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(radius * 3));
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    this.renderer.setClippingPlanes([]);
    await this.renderer.update(camera, signal);
  }

  getSpatialStructure(): Promise<SpatialTreeItem> {
    if (this.semantic?.getSpatialStructure) return this.semantic.getSpatialStructure();
    const groups = new Map<number, SpatialTreeItem[]>();
    for (let index = 0; index < this.renderer.productIds.length; index++) {
      const type = this.renderer.productTypeIds[index];
      const children = groups.get(type) ?? [];
      children.push({ category: `IFC type ${type}`, localId: this.renderer.productIds[index] });
      groups.set(type, children);
    }
    return Promise.resolve({
      category: "Model",
      localId: null,
      children: [...groups].map(([type, children]) => ({ category: `IFC type ${type}`, localId: null, children })),
    });
  }

  getLocalIdsByGuids(guids: string[]) {
    return this.semantic?.getLocalIdsByGuids?.(guids) ?? Promise.resolve(guids.map(() => null));
  }

  getItemsIdsWithGeometry() { return Promise.resolve(Array.from(this.renderer.productIds)); }

  async getItemsOfCategories(categories: RegExp[]) {
    if (this.semantic?.getItemsOfCategories) return this.semantic.getItemsOfCategories(categories);
    const result: Record<string, number[]> = {};
    for (let index = 0; index < this.renderer.productIds.length; index++) {
      const category = `IFC type ${this.renderer.productTypeIds[index]}`;
      if (!categories.some(pattern => {
        pattern.lastIndex = 0;
        return pattern.test(category);
      })) continue;
      (result[category] ??= []).push(this.renderer.productIds[index]);
    }
    return result;
  }

  getGuids() { return this.semantic?.getGuids?.() ?? Promise.resolve([]); }
  getGuidsByLocalIds(localIds: number[]) {
    return this.semantic?.getGuidsByLocalIds?.(localIds) ?? Promise.resolve(localIds.map(() => null));
  }

  async getItemsData(ids: number[], config?: Record<string, unknown>): Promise<ItemData[]> {
    if (this.semantic?.getItemsData) return this.semantic.getItemsData(ids, config);
    const typeById = new Map<number, number>();
    for (let index = 0; index < this.renderer.productIds.length; index++) typeById.set(this.renderer.productIds[index], this.renderer.productTypeIds[index]);
    return ids.map(id => ({
      expressID: { value: id },
      _category: { value: typeById.get(id) ?? "Unknown" },
    }) as unknown as ItemData);
  }

  getCoordinationMatrix() { return Promise.resolve(this.sourceToViewer.clone()); }
  getMergedBox(localIds: number[]) { return Promise.resolve(this.renderer.getMergedBox(localIds)); }

  async raycast(data: ViewerRaycastData): Promise<ViewerRaycastResult | null> {
    return this.wrapHit(this.renderer.raycast(data), SnappingClass.FACE);
  }

  async raycastWithSnapping(data: ViewerSnappingRaycastData): Promise<ViewerRaycastResult[] | null> {
    const hit = this.renderer.raycast(data);
    if (!hit) return null;
    const results: ViewerRaycastResult[] = [];
    if (hit.triangle && data.snappingClasses.includes(SnappingClass.POINT)) {
      const point = [...hit.triangle].sort((a, b) => a.distanceToSquared(hit.point) - b.distanceToSquared(hit.point))[0];
      results.push(this.wrapHit({ ...hit, point }, SnappingClass.POINT)!);
    }
    if (hit.triangle && data.snappingClasses.includes(SnappingClass.LINE)) {
      const edges = [[0, 1], [1, 2], [2, 0]] as const;
      const closest = new THREE.Vector3();
      const edge = edges.map(([a, b]) => {
        const line = new THREE.Line3(hit.triangle![a], hit.triangle![b]);
        line.closestPointToPoint(hit.point, true, closest);
        return { a: hit.triangle![a], b: hit.triangle![b], point: closest.clone(), distance: closest.distanceToSquared(hit.point) };
      }).sort((a, b) => a.distance - b.distance)[0];
      const result = this.wrapHit({ ...hit, point: edge.point }, SnappingClass.LINE)!;
      result.snappedEdgeP1 = edge.a.clone(); result.snappedEdgeP2 = edge.b.clone();
      results.push(result);
    }
    if (data.snappingClasses.includes(SnappingClass.FACE)) results.push(this.wrapHit(hit, SnappingClass.FACE)!);
    return results.length ? results : null;
  }

  async rectangleRaycast(data: ViewerRectangleRaycastData): Promise<ViewerRectangleRaycastResult | null> {
    const localIds = this.renderer.rectangleSelect(data);
    return localIds.length ? { localIds, fragments: this } : null;
  }

  async setVisible(localIds: number[] | undefined, visible: boolean) { this.renderer.setVisible(localIds, visible); }
  async highlight(localIds: number[] | undefined, material: ViewerHighlightMaterial) {
    this.renderer.highlight(localIds, new THREE.Vector4(material.color.r, material.color.g, material.color.b, material.opacity));
  }
  async resetHighlight(localIds?: number[]) { this.renderer.resetHighlight(localIds); }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.onChange = null;
    this.renderer.dispose();
    this.planner.dispose();
    this.semantic?.dispose?.();
    this.onViewUpdated.clear();
  }

  private wrapHit(hit: EngineV2RendererHit | null, snappingClass: SnappingClass): ViewerRaycastResult | null {
    if (!hit) return null;
    return {
      localId: hit.productId,
      itemId: hit.productId,
      point: hit.point.clone(),
      normal: hit.normal?.clone(),
      distance: hit.distance,
      rayDistance: hit.distance,
      object: hit.object,
      fragments: this,
      ray: hit.ray.clone(),
      snappingClass,
    };
  }
}

export async function createEngineV2Model(
  modelId: string,
  artifact: EngineV2ArtifactBuffers,
  signal?: AbortSignal,
  options: EngineV2ModelOptions = {},
): Promise<EngineV2Model> {
  const manifest = artifact.manifest;
  const planner = new EngineV2PlannerClient();
  try {
    const plan = await planner.initialize(artifact, signal, options.planner);
    const renderer = new EngineV2PageRenderer(planner, manifest, plan, options.renderer);
    return new EngineV2Model(modelId, planner, renderer, manifest, options.semantic);
  } catch (error) {
    planner.dispose();
    throw error;
  }
}
