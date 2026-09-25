import { api, type EngineV2JobResponse } from "../api.ts";
import { ArtifactEngineV2SemanticSource } from "./artifact-semantic-source.ts";
import { engineV2ApiTransport } from "./api-transport.ts";
import { readEngineV2Artifact } from "./artifact-reader.ts";
import { createEngineV2Model, type EngineV2Model } from "./engine-v2-model.ts";

const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason ?? new DOMException("Engine V2 load cancelled", "AbortError")); return; }
  const timer = window.setTimeout(done, milliseconds);
  function done() { signal.removeEventListener("abort", cancel); resolve(); }
  function cancel() { window.clearTimeout(timer); reject(signal.reason ?? new DOMException("Engine V2 load cancelled", "AbortError")); }
  signal.addEventListener("abort", cancel, { once: true });
});

export interface EngineV2LoadResult {
  model: EngineV2Model;
  artifactKey: string;
  cacheHit: boolean;
  conversionMilliseconds: number;
  artifactLoadMilliseconds: number;
  artifactBytes: number;
  recoveredDisjointFaces: number;
}

export class EngineV2UnsupportedGeometryError extends Error {
  constructor(message: string) {
    super(`Engine V2 chưa hỗ trợ hình học của file này: ${message.slice("engine_v2_fallback_required:".length).trim()}`);
    this.name = "EngineV2UnsupportedGeometryError";
  }
}

async function waitForReady(initial: EngineV2JobResponse, signal: AbortSignal, onPhase: (phase: string) => void) {
  let job = initial;
  while (!job.ready) {
    if (job.state === "error") {
      const message = job.error || "Engine V2 conversion failed";
      if (message.startsWith("engine_v2_fallback_required:")) throw new EngineV2UnsupportedGeometryError(message);
      throw new Error(message);
    }
    if (job.state === "cancelled") throw new DOMException("Engine V2 conversion cancelled", "AbortError");
    onPhase(job.phase);
    await wait(250, signal);
    job = await api.engineV2Job(job.jobId, signal);
  }
  return job;
}

export async function loadEngineV2Model(
  modelId: string,
  modelHash: string,
  signal: AbortSignal,
  onProgress: (progress: number | undefined, phase: string) => void,
): Promise<EngineV2LoadResult> {
  const conversionStarted = performance.now();
  const initial = await api.prepareEngineV2(modelHash);
  let ready: EngineV2JobResponse;
  try {
    ready = await waitForReady(initial, signal, phase => onProgress(undefined, phase));
  } catch (error) {
    if (!initial.ready) void api.cancelEngineV2Job(initial.jobId).catch(() => {});
    throw error;
  }
  const conversionMilliseconds = performance.now() - conversionStarted;
  const artifactStarted = performance.now();
  const artifact = await readEngineV2Artifact(engineV2ApiTransport, ready.artifactKey, modelHash, signal, progress => {
    onProgress(progress.totalBytes ? progress.completedBytes / progress.totalBytes : undefined, progress.file ?? "manifest");
  });
  const artifactBytes = Object.values(artifact.chunks).reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const semantic = new ArtifactEngineV2SemanticSource(ready.artifactKey, artifact.manifest, engineV2ApiTransport);
  const model = await createEngineV2Model(modelId, artifact, signal, { semantic });
  return {
    model,
    artifactKey: ready.artifactKey,
    cacheHit: initial.ready,
    conversionMilliseconds,
    artifactLoadMilliseconds: performance.now() - artifactStarted,
    artifactBytes,
    recoveredDisjointFaces: artifact.manifest.recoveredDisjointFaces,
  };
}
