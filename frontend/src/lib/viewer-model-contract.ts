import type * as THREE from "three";
import type { ItemData, SpatialTreeItem, SnappingClass } from "./viewer-native-types";

export interface ViewerModelEvent {
  add(listener: (model: ViewerModel) => void): void;
  remove(listener: (model: ViewerModel) => void): void;
}

export interface ViewerRaycastData {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  mouse: THREE.Vector2;
  dom: HTMLCanvasElement;
}

export interface ViewerSnappingRaycastData extends ViewerRaycastData {
  snappingClasses: SnappingClass[];
}

export interface ViewerRectangleRaycastData {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  dom: HTMLCanvasElement;
  topLeft: THREE.Vector2;
  bottomRight: THREE.Vector2;
  fullyIncluded: boolean;
}

export interface ViewerRaycastResult {
  localId: number;
  itemId: number;
  point: THREE.Vector3;
  normal?: THREE.Vector3;
  distance: number;
  rayDistance?: number;
  object: THREE.Object3D;
  fragments: ViewerModel;
  ray?: THREE.Ray;
  snappingClass: SnappingClass;
  snappedEdgeP1?: THREE.Vector3;
  snappedEdgeP2?: THREE.Vector3;
}

export interface ViewerRectangleRaycastResult {
  localIds: number[];
  fragments: ViewerModel;
}

export interface ViewerHighlightMaterial {
  color: THREE.Color;
  renderedFaces: number;
  opacity: number;
  transparent: boolean;
}

export interface ViewerModel {
  readonly engine: "engine-v2";
  readonly modelId: string;
  readonly object: THREE.Object3D;
  readonly box: THREE.Box3;
  frozen: boolean;
  readonly onViewUpdated: ViewerModelEvent;
  getClippingPlanesEvent: () => THREE.Plane[];

  getSpatialStructure(): Promise<SpatialTreeItem>;
  getLocalIdsByGuids(guids: string[]): Promise<(number | null)[]>;
  getItemsIdsWithGeometry(): Promise<number[]>;
  getItemsOfCategories(categories: RegExp[]): Promise<Record<string, number[]>>;
  getGuids(): Promise<string[]>;
  getGuidsByLocalIds(localIds: number[]): Promise<(string | null)[]>;
  getItemsData(ids: number[], config?: Record<string, unknown>): Promise<ItemData[]>;
  getCoordinationMatrix(): Promise<THREE.Matrix4>;
  getMergedBox(localIds: number[]): Promise<THREE.Box3>;
  update?(camera: THREE.Camera, signal?: AbortSignal): Promise<void>;
  cancelUpdate?(): void;

  raycast(data: ViewerRaycastData): Promise<ViewerRaycastResult | null>;
  rectangleRaycast(data: ViewerRectangleRaycastData): Promise<ViewerRectangleRaycastResult | null>;
  raycastWithSnapping(data: ViewerSnappingRaycastData): Promise<ViewerRaycastResult[] | null>;
  setVisible(localIds: number[] | undefined, visible: boolean): Promise<void>;
  highlight(localIds: number[] | undefined, material: ViewerHighlightMaterial): Promise<void>;
  resetHighlight(localIds?: number[]): Promise<void>;
  dispose(): Promise<void>;
}

export class ViewerModelSignal implements ViewerModelEvent {
  private readonly listeners = new Set<(model: ViewerModel) => void>();
  add(listener: (model: ViewerModel) => void) { this.listeners.add(listener); }
  remove(listener: (model: ViewerModel) => void) { this.listeners.delete(listener); }
  emit(model: ViewerModel) { for (const listener of this.listeners) listener(model); }
  clear() { this.listeners.clear(); }
}
