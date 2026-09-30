/** Return the exact payload without copying a full-span worker result. */
export function fragmentArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  // Subarrays must not expose unrelated bytes from a larger backing buffer.
  return bytes.slice().buffer as ArrayBuffer;
}
