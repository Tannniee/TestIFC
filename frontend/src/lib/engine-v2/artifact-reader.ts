import { validateEngineV2ChunkHeader } from "./chunk-header.ts";
import {
  engineV2Chunk,
  validateEngineV2Manifest,
  type EngineV2ChunkFile,
  type EngineV2Manifest,
} from "./manifest.ts";

export const ENGINE_V2_RENDER_CHUNKS = [
  "meshes.ifcv2",
  "indices.ifcv2",
  "instances.ifcv2",
  "products.ifcv2",
  "materials.ifcv2",
  "instance-materials.ifcv2",
  "normals.ifcv2",
  "positions-f64.ifcv2",
] as const satisfies readonly EngineV2ChunkFile[];

export type EngineV2RenderChunk = (typeof ENGINE_V2_RENDER_CHUNKS)[number];

export interface EngineV2ArtifactTransport {
  getManifest(artifactKey: string, signal: AbortSignal): Promise<unknown>;
  getChunk(artifactKey: string, file: EngineV2ChunkFile, signal: AbortSignal): Promise<ArrayBuffer>;
  getChunkRange(artifactKey: string, file: EngineV2ChunkFile, offset: number, length: number, signal: AbortSignal): Promise<ArrayBuffer>;
}

export interface EngineV2ArtifactBuffers {
  manifest: EngineV2Manifest;
  chunks: Record<EngineV2RenderChunk, ArrayBuffer>;
}

export interface EngineV2ReadProgress {
  completedBytes: number;
  totalBytes: number;
  completedChunks: number;
  totalChunks: number;
  file: EngineV2RenderChunk | null;
}

function aborted(signal: AbortSignal): never {
  throw signal.reason instanceof Error ? signal.reason : new DOMException("Engine V2 load cancelled", "AbortError");
}

/** Read only the renderer inputs and keep at most three HTTP bodies in flight. */
export async function readEngineV2Artifact(
  transport: EngineV2ArtifactTransport,
  artifactKey: string,
  expectedSourceHash: string,
  signal: AbortSignal,
  onProgress: (progress: EngineV2ReadProgress) => void = () => {},
): Promise<EngineV2ArtifactBuffers> {
  if (signal.aborted) aborted(signal);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason ?? new DOMException("Engine V2 load cancelled", "AbortError"));
  signal.addEventListener("abort", forwardAbort, { once: true });
  try {
    const manifest = validateEngineV2Manifest(await transport.getManifest(artifactKey, controller.signal), expectedSourceHash);
    const totalBytes = ENGINE_V2_RENDER_CHUNKS.reduce((sum, file) => sum + engineV2Chunk(manifest, file).sizeBytes, 0);
    let completedBytes = 0;
    let completedChunks = 0;
    const chunks = {} as Record<EngineV2RenderChunk, ArrayBuffer>;
    let cursor = 0;
    onProgress({ completedBytes, totalBytes, completedChunks, totalChunks: ENGINE_V2_RENDER_CHUNKS.length, file: null });

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= ENGINE_V2_RENDER_CHUNKS.length) return;
        if (controller.signal.aborted) aborted(controller.signal);
        const file = ENGINE_V2_RENDER_CHUNKS[index];
        const descriptor = engineV2Chunk(manifest, file);
        const buffer = await transport.getChunk(artifactKey, file, controller.signal);
        if (controller.signal.aborted) aborted(controller.signal);
        validateEngineV2ChunkHeader(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 32)), descriptor, buffer.byteLength);
        chunks[file] = buffer;
        completedBytes += buffer.byteLength;
        completedChunks++;
        onProgress({ completedBytes, totalBytes, completedChunks, totalChunks: ENGINE_V2_RENDER_CHUNKS.length, file });
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
    } catch (error) {
      controller.abort(error);
      throw error;
    }
    return { manifest, chunks };
  } finally {
    signal.removeEventListener("abort", forwardAbort);
  }
}
