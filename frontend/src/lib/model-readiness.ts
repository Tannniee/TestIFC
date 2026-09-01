import type { BridgeProgress, ViewerProgress } from "./viewer-contracts";

export interface ModelReadiness {
  loadSequence: number;
  modelHash: string | null;
  fileName: string | null;
  geometry: ViewerProgress;
  semantic: BridgeProgress;
}

export function emptyModelReadiness(): ModelReadiness {
  return {
    loadSequence: 0,
    modelHash: null,
    fileName: null,
    geometry: { loadSequence: 0, modelHash: null, stage: "idle" },
    semantic: { loadSequence: 0, modelHash: null, stage: "idle" },
  };
}

export function beginModelLoad(loadSequence: number, fileName: string): ModelReadiness {
  return {
    loadSequence,
    modelHash: null,
    fileName,
    geometry: { loadSequence, modelHash: null, stage: "reading", detail: fileName },
    semantic: { loadSequence, modelHash: null, stage: "activating", detail: fileName },
  };
}

function accepts(
  readiness: ModelReadiness,
  event: { loadSequence: number; modelHash: string | null },
): boolean {
  if (event.loadSequence !== readiness.loadSequence) return false;
  return !readiness.modelHash || !event.modelHash || readiness.modelHash === event.modelHash;
}

function withIdentity(
  readiness: ModelReadiness,
  event: { modelHash: string | null },
): ModelReadiness {
  return !readiness.modelHash && event.modelHash
    ? { ...readiness, modelHash: event.modelHash }
    : readiness;
}

export function applyGeometryProgress(
  readiness: ModelReadiness,
  event: ViewerProgress,
): ModelReadiness {
  if (!accepts(readiness, event)) return readiness;
  const current = withIdentity(readiness, event);
  return { ...current, geometry: event };
}

export function applySemanticProgress(
  readiness: ModelReadiness,
  event: BridgeProgress,
): ModelReadiness {
  if (!accepts(readiness, event)) return readiness;
  const current = withIdentity(readiness, event);
  return { ...current, semantic: event };
}

export function geometryReady(readiness: ModelReadiness): boolean {
  return readiness.geometry.stage === "ready";
}

export function semanticReady(readiness: ModelReadiness): boolean {
  return readiness.semantic.stage === "ready";
}
