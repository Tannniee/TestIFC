import { validateEngineV2ChunkHeader } from "./chunk-header.ts";
import {
  engineV2Chunk,
  validateEngineV2Manifest,
  type EngineV2ChunkFile,
  type EngineV2Manifest,
} from "./manifest.ts";

/** Immutable, renderer-neutral boundary for one validated Engine V2 artifact. */
export class EngineV2ArtifactContract {
  readonly manifest: EngineV2Manifest;

  constructor(rawManifest: unknown, expectedSourceHash: string) {
    this.manifest = validateEngineV2Manifest(rawManifest, expectedSourceHash);
  }

  validateChunkHeader(file: EngineV2ChunkFile, header: Uint8Array, completeChunkBytes?: number) {
    return validateEngineV2ChunkHeader(header, engineV2Chunk(this.manifest, file), completeChunkBytes);
  }
}
