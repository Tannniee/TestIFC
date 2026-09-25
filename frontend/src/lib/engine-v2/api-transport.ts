import { api } from "../api.ts";
import type { EngineV2ArtifactTransport } from "./artifact-reader.ts";
import type { EngineV2ChunkFile } from "./manifest.ts";

/** HTTP adapter only; the production loader decides when an artifact may become active. */
export const engineV2ApiTransport: EngineV2ArtifactTransport = {
  getManifest(artifactKey: string, signal: AbortSignal) {
    return api.engineV2Manifest(artifactKey, signal);
  },
  getChunk(artifactKey: string, file: EngineV2ChunkFile, signal: AbortSignal) {
    return api.engineV2Chunk(artifactKey, file, signal);
  },
  getChunkRange(artifactKey: string, file: EngineV2ChunkFile, offset: number, length: number, signal: AbortSignal) {
    return api.engineV2ChunkRange(artifactKey, file, offset, length, signal);
  },
};
