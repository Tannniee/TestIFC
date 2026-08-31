import type { ItemData } from "@thatopen/fragments";
import type { SelectionElement } from "./api";

export type ViewerStage =
  | "uploading"
  | "cache"
  | "reading"
  | "converting"
  | "loading"
  | "ready"
  | "selecting"
  | "error";

export type ViewportBackground = "gray" | "white" | "oled";
export type ViewPreset = "iso" | "positiveX" | "negativeX" | "positiveY" | "negativeY" | "positiveZ" | "negativeZ";
export type SectionSide = "positive" | "negative";
export type ViewStep = -1 | 0 | 1;

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

export interface ViewerProgress {
  stage: ViewerStage;
  progress?: number;
  detail?: string;
}

export interface ViewerSelection extends SelectionElement {
  modelId: string;
  modelName: string;
  raw: ItemData | null;
}

export type BridgeStage = "activating" | "uploading" | "preparing" | "ready" | "cleared" | "error";

export interface BridgeProgress {
  stage: BridgeStage;
  progress?: number;
  detail?: string;
}

export interface ViewerCallbacks {
  onProgress(event: ViewerProgress): void;
  onBridgeProgress(event: BridgeProgress): void;
  onSelection(selection: ViewerSelection | null): void;
  onBoxZoomActiveChange(active: boolean): void;
  onSectionPickActiveChange(active: boolean): void;
  onSectionPlaneChange(section: SectionPlaneDefinition | null): void;
  onCameraOrientationChange(orientation: CameraOrientation): void;
  onAuthorizationRequired(error: unknown): void;
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
