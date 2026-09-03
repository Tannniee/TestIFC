import type { MeasurementResult, SectionBoxState, SectionPlaneDefinition, Vector3Value } from "./viewer-contracts";
import type { ModelReadiness } from "./model-readiness";

export interface CameraSessionState {
  position: Vector3Value; target: Vector3Value; up: Vector3Value;
  effectiveHeight: number; zoom: number; near: number; far: number;
}
export type ClippingSessionState = { kind: "none" }
  | { kind: "sectionPlane"; definition: SectionPlaneDefinition }
  | { kind: "sectionBox"; box: SectionBoxState };
export type ElementRef = { modelHash: string; globalId: string | null; artifactId: string; localId: number };
export interface ViewSessionState {
  schemaVersion: 1;
  coordinateSpaceVersion: "viewer-v1";
  camera: CameraSessionState;
  clipping: ClippingSessionState;
  selection: ElementRef[];
  measurements: MeasurementResult[];
  boxDisplay: { showBox: boolean; showHandles: boolean };
}
export interface ViewSession { id: string; name: string; type: "default3d" | "sectionBox"; state: ViewSessionState }
export interface DocumentSession {
  id: string; modelHash: string; filename: string; activeViewId: string; views: ViewSession[];
  readiness: ModelReadiness; error: string | null; expandedNodes: string[];
  sourceIssue?: "unavailable" | "changed" | null;
}
export interface WorkspaceState {
  documents: DocumentSession[]; activeDocumentId: string | null; requestedDocumentId: string | null;
  busy: boolean; error: string | null;
}
export const emptyWorkspace = (): WorkspaceState => ({ documents: [], activeDocumentId: null, requestedDocumentId: null, busy: false, error: null });
export function activeDocument(state: WorkspaceState) { return state.documents.find(d => d.id === state.activeDocumentId) ?? null; }
export function activeView(state: WorkspaceState) { const d = activeDocument(state); return d?.views.find(v => v.id === d.activeViewId) ?? null; }

export function validateViewState(state: ViewSessionState): void {
  const vector = (v: Vector3Value) => v && [v.x, v.y, v.z].every(Number.isFinite);
  const c = state.camera;
  if (state.schemaVersion !== 1 || state.coordinateSpaceVersion !== "viewer-v1" || !c
    || ![c.position, c.target, c.up].every(vector)
    || ![c.effectiveHeight, c.zoom, c.near, c.far].every(Number.isFinite)
    || c.effectiveHeight <= 0 || c.zoom <= 0 || c.near < 0 || c.far <= c.near
    || Math.hypot(c.up.x, c.up.y, c.up.z) < 1e-9
    || Math.hypot(c.position.x-c.target.x, c.position.y-c.target.y, c.position.z-c.target.z) < 1e-9) throw new Error("Invalid view camera");
  const clip = state.clipping;
  if (clip.kind === "sectionBox" && (![clip.box.min, clip.box.max].every(vector)
    || !(["x", "y", "z"] as const).every(a => clip.box.min[a] < clip.box.max[a]))) throw new Error("Invalid Section Box");
  if (clip.kind === "sectionPlane" && (!vector(clip.definition.point) || !vector(clip.definition.normal)
    || Math.hypot(...Object.values(clip.definition.normal)) < 1e-9
    || !["positive", "negative"].includes(clip.definition.side))) throw new Error("Invalid Section Plane");
  if (!["none", "sectionPlane", "sectionBox"].includes(clip.kind)) throw new Error("Invalid clipping mode");
  if (!state.measurements.every(m => vector(m.start) && vector(m.end) && Number.isFinite(m.distance) && m.distance >= 0
    && Number.isSafeInteger(m.id) && m.id > 0 && ["pointToPoint", "edge"].includes(m.mode))) throw new Error("Invalid measurements");
  if (new Set(state.measurements.map(m => m.id)).size !== state.measurements.length) throw new Error("Duplicate measurement ID");
  if (!state.selection.every(ref => typeof ref.modelHash === "string" && typeof ref.artifactId === "string"
    && (ref.globalId === null || typeof ref.globalId === "string") && Number.isSafeInteger(ref.localId) && ref.localId >= 0)) throw new Error("Invalid selection");
  if (typeof state.boxDisplay.showBox !== "boolean" || typeof state.boxDisplay.showHandles !== "boolean") throw new Error("Invalid box display");
}
