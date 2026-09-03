import type { SemanticProgress } from "./api-contracts";
import type { ItemData } from "@thatopen/fragments";
import type { SelectionElement } from "./api";
import type { FragmentMetadataProfile } from "./fragment-profile";
import type { ViewSessionState } from "./workspace-contracts";

export type ViewerStage =
  | "idle"
  | "cache"
  | "reading"
  | "hashing"
  | "converting"
  | "loading"
  | "finalizing"
  | "cancelled"
  | "ready"
  | "error";

export type ViewportBackground = "gray" | "white" | "oled";
export type ViewPreset = "iso" | "positiveX" | "negativeX" | "positiveY" | "negativeY" | "positiveZ" | "negativeZ";
export type SectionSide = "positive" | "negative";
export type ViewStep = -1 | 0 | 1;
export type ViewerTool = "pan" | "selectOrbit" | "multiSelect" | "measure";
export type MeasureMode = "pointToPoint" | "edge";

export interface ViewDirection {
  x: ViewStep;
  y: ViewStep;
  z: ViewStep;
}

export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

export interface CameraOrientation {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SectionPlaneDefinition {
  point: Vector3Value;
  normal: Vector3Value;
  side: SectionSide;
}

export interface SectionBoxState {
  enabled: boolean;
  min: Vector3Value;
  max: Vector3Value;
}

export interface MeasurementResult {
  id: number;
  mode: MeasureMode;
  start: Vector3Value;
  end: Vector3Value;
  distance: number;
}

export interface ViewerProgress {
  loadSequence: number;
  modelHash: string | null;
  stage: ViewerStage;
  progress?: number;
  detail?: string;
  phase?: "conversion" | "geometries" | "attributes" | "relations" | "decompressing" | "parsing" | "generating" | "done";
  entitiesProcessed?: number;
  category?: string;
}

export interface ViewerSelection extends SelectionElement {
  modelId: string;
  modelName: string;
  raw: ItemData | null;
}

export type BridgeStage =
  | "stalled"
  | "idle"
  | "activating"
  | "uploading"
  | "indexing_hot"
  | "indexing_cold"
  | "cancelled"
  | "ready"
  | "error";

export interface BridgeProgress {
  semantic?: SemanticProgress | null;
  canRetry?: boolean;
  loadSequence: number;
  modelHash: string | null;
  stage: BridgeStage;
  progress?: number;
  detail?: string;
}

export interface FragmentMetrics {
  loadSequence: number;
  modelHash: string;
  profile: FragmentMetadataProfile;
  cacheHit: boolean;
  ifcBytes: number;
  fragmentBytes: number;
  conversionMilliseconds: number;
  fragmentLoadMilliseconds: number;
  totalMilliseconds: number;
}

export interface ViewerCallbacks {
  onProgress(event: ViewerProgress): void;
  onBridgeProgress(event: BridgeProgress): void;
  onFragmentMetrics(event: FragmentMetrics): void;
  onSelection(selection: ViewerSelection | null): void;
  onMultiSelectionChange(count: number): void;
  onMeasurementChange(measurements: MeasurementResult[]): void;
  onBoxZoomActiveChange(active: boolean): void;
  onSectionPickActiveChange(active: boolean): void;
  onSectionPlaneChange(section: SectionPlaneDefinition | null): void;
  onSectionBoxChange?(box: SectionBoxState | null): void;
  onSectionBoxPickActiveChange?(active: boolean): void;
  onCameraOrientationChange(orientation: CameraOrientation): void;
  onSectionBoxCreated?(state: ViewSessionState): void;
  onViewStateChange?(): void;
  onInteractionError?(message: string): void;
  onSectionBoxEdit?(): void;
}

export class LoadCancelledError extends Error {
  constructor() {
    super("Model load was replaced by a newer request");
    this.name = "LoadCancelledError";
  }
}

export function isLoadCancelledError(error: unknown): boolean {
  return error instanceof LoadCancelledError;
}
