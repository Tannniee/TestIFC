import type { EngineV2ChunkDescriptor } from "./manifest";

export const ENGINE_V2_CHUNK_HEADER_BYTES = 32;

export interface EngineV2ChunkHeader {
  version: number;
  kind: number;
  headerBytes: number;
  payloadBytes: number;
  recordCount: number;
  flags: number;
}

export function parseEngineV2ChunkHeader(bytes: Uint8Array): EngineV2ChunkHeader {
  if (bytes.byteLength < ENGINE_V2_CHUNK_HEADER_BYTES) throw new Error("Engine V2 chunk header is truncated");
  const expectedMagic = [73, 70, 67, 86, 50, 67, 72, 75];
  for (let index = 0; index < expectedMagic.length; index += 1) {
    if (bytes[index] !== expectedMagic[index]) throw new Error("Engine V2 chunk magic is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, ENGINE_V2_CHUNK_HEADER_BYTES);
  const payload = view.getBigUint64(16, true);
  if (payload > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Engine V2 chunk payload is too large");
  return {
    version: view.getUint16(8, true),
    kind: view.getUint16(10, true),
    headerBytes: view.getUint32(12, true),
    payloadBytes: Number(payload),
    recordCount: view.getUint32(24, true),
    flags: view.getUint32(28, true),
  };
}

export function validateEngineV2ChunkHeader(
  bytes: Uint8Array,
  descriptor: EngineV2ChunkDescriptor,
  completeChunkBytes?: number,
): EngineV2ChunkHeader {
  const header = parseEngineV2ChunkHeader(bytes);
  if (header.version !== 1 || header.headerBytes !== ENGINE_V2_CHUNK_HEADER_BYTES || header.flags !== 0) {
    throw new Error(`${descriptor.file} uses an unsupported chunk protocol`);
  }
  if (
    header.kind !== descriptor.kind
    || header.payloadBytes !== descriptor.payloadBytes
    || header.recordCount !== descriptor.recordCount
  ) {
    throw new Error(`${descriptor.file} header does not match its manifest`);
  }
  if (completeChunkBytes !== undefined && completeChunkBytes !== descriptor.sizeBytes) {
    throw new Error(`${descriptor.file} byte length does not match its manifest`);
  }
  return header;
}
