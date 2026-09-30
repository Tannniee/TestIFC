import assert from "node:assert/strict";
import test from "node:test";
import { fragmentArrayBuffer } from "../src/lib/fragment-buffer.ts";

test("full-span fragment buffers reuse the worker allocation", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(fragmentArrayBuffer(bytes), bytes.buffer);
});

test("a fragment subarray copies only its payload", () => {
  const bytes = new Uint8Array([99, 1, 2, 3, 99]);
  const buffer = fragmentArrayBuffer(bytes.subarray(1, 4));
  assert.notEqual(buffer, bytes.buffer);
  assert.deepEqual([...new Uint8Array(buffer)], [1, 2, 3]);
});

test("upload body keeps exact bytes after the loader transfers its buffer", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const request = new Request("http://localhost/fragments", { method: "POST", body: bytes });
  const buffer = fragmentArrayBuffer(bytes);
  const received = structuredClone(buffer, { transfer: [buffer] });
  assert.equal(bytes.byteLength, 0);
  assert.deepEqual([...new Uint8Array(await request.arrayBuffer())], [1, 2, 3, 4]);
  assert.deepEqual([...new Uint8Array(received)], [1, 2, 3, 4]);
});
