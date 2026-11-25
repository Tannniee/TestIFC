/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate, setTimeout as yieldTask } from 'node:timers/promises';
import type { MeshData } from '@ifc-lite/geometry';
import type { RenderPipeline } from './pipeline.js';
import { createSceneBatch, createSceneBatchAsync } from './scene-batch-upload.js';
import { Scene } from './scene.js';
import { flushMeshUniforms, meshUniformArena } from './mesh-uniform-arena.js';
import { destroyGpuResources } from './scene-geometry.js';
import type { BatchedMesh } from './types.js';

(globalThis as Record<string, unknown>).GPUBufferUsage = {
  COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128,
};

interface CapturedBuffer {
  size: number;
  usage: number;
  contents: Uint8Array;
  destroyed: number;
  destroy(): void;
}

function captureDevice(onWrite?: () => void) {
  const created: CapturedBuffer[] = [];
  const device = {
    createBuffer(descriptor: GPUBufferDescriptor): CapturedBuffer {
      assert.ok(!descriptor.mappedAtCreation);
      const buffer = {
        size: descriptor.size, usage: descriptor.usage,
        contents: new Uint8Array(descriptor.size), destroyed: 0,
        destroy() { this.destroyed++; },
      };
      created.push(buffer);
      return buffer;
    },
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      copyBufferToBuffer(from: CapturedBuffer, src: number, to: CapturedBuffer, dst: number, size: number) {
        to.contents.set(from.contents.subarray(src, src + size), dst);
      }, finish: () => ({}),
    }),
    queue: {
      submit() {},
      writeBuffer(buffer: CapturedBuffer, offset: number, data: ArrayBufferView | ArrayBuffer) {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
        assert.equal(bytes.byteLength % 4, 0);
        assert.ok(offset + bytes.byteLength <= buffer.size);
        buffer.contents.set(bytes, offset);
        onWrite?.();
      },
    },
  };
  return { device: device as unknown as GPUDevice, created };
}

const pipeline = {
  getUniformBufferSize: () => 256,
  getBindGroupLayout: () => ({}),
} as unknown as RenderPipeline;
const color: [number, number, number, number] = [0.2, 0.3, 0.4, 1];
const origin: [number, number, number] = [5_000_000.25, -2_000_000.5, 100.125];

function grid(n: number, expressId = 42): MeshData {
  const side = n + 1;
  const positions = new Float32Array(side * side * 3);
  const normals = new Float32Array(positions.length);
  const entityIds = new Uint32Array(side * side);
  const indices = new Uint32Array(n * n * 6);
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      const vertex = y * side + x;
      positions[vertex * 3] = x / n;
      positions[vertex * 3 + 1] = y / n;
      // Include zero and non-unit normals to exercise exact oct-encoding parity.
      normals[vertex * 3 + 2] = vertex % 11 === 0 ? 0 : 2;
      entityIds[vertex] = vertex % 13 === 0 ? 100 : expressId;
    }
  }
  let offset = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * side + x, b = a + 1, c = a + side, d = c + 1;
      indices.set([a, b, d, a, d, c], offset);
      offset += 6;
    }
  }
  return { expressId, positions, normals, indices, entityIds, color,
    origin: [...origin], modelIndex: 7, material: { metallic: 0.25, roughness: 0.7 } };
}

function bytes(buffers: CapturedBuffer[]) {
  return buffers.map(buffer => ({ size: buffer.size, usage: buffer.usage, contents: buffer.contents }));
}

/** Batch buffers die immediately; arena pages belong to the device and retain
 * released slots until the next frame flush. Verify both ownership contracts. */
function assertReleased(device: GPUDevice, buffers: CapturedBuffer[], exact = true): void {
  for (const buffer of buffers) {
    if (buffer.usage & GPUBufferUsage.UNIFORM) {
      assert.equal(buffer.destroyed, 0, 'batch cleanup must not destroy a shared uniform page');
    } else {
      assert.ok(exact ? buffer.destroyed === 1 : buffer.destroyed >= 1,
        `batch-owned allocation disposal count ${buffer.destroyed}`);
    }
  }
  flushMeshUniforms(device);
  assert.equal(meshUniformArena(device, pipeline.getUniformBufferSize()).liveSlots, 0,
    'all released batch uniform slots are recycled by the frame flush');
}

for (const quantized of ['off', 'required'] as const) {
  it(`async preparation preserves every uploaded byte, LOD and ownership (${quantized})`, async () => {
    const meshes = [grid(100), { ...grid(5, 314), origin: [origin[0] + 0.125, origin[1], origin[2]],
      normals: new Float32Array(0), modelIndex: 9 } satisfies MeshData];
    const options = { id: 17, colorKey: 'same-material', origin, quantized, lod: true };
    const referenceDevice = captureDevice();
    const reference = createSceneBatch(meshes, color, referenceDevice.device, pipeline, options, 'bucket');
    const actualDevice = captureDevice();
    let clock = 0, yields = 0;
    const actual = await createSceneBatchAsync(meshes, color, actualDevice.device, pipeline, options, 'bucket', {
      budgetMs: 0, now: () => ++clock, yieldControl: async () => { yields++; await setImmediate(); },
    });
    assert.ok(reference.lod1IndexBuffer, 'fixture must actually create LOD1');
    assert.ok(actual.lod1IndexBuffer);
    assert.deepEqual(bytes(actualDevice.created), bytes(referenceDevice.created));
    for (const key of ['id', 'colorKey', 'indexCount', 'lod1IndexCount', 'origin', 'bounds',
      'expressIds', 'modelIndices', 'color', 'finish', 'quantized'] as const) {
      assert.deepEqual(actual[key], reference[key], `batch ${key}`);
    }
    assert.ok(yields > 1, 'CPU preparation yielded repeatedly');
    assert.ok(actualDevice.created.every(buffer => buffer.destroyed === 0));
  });
}

it('runs other scheduled work between preparation chunks of one large mesh', async () => {
  const mesh = grid(150);
  let numericReads = 0;
  mesh.positions = new Proxy(mesh.positions, {
    get(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) numericReads++;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const { device, created } = captureDevice();
  let clock = 0;
  const partialReads: number[] = [];
  await createSceneBatchAsync([mesh], color, device, pipeline,
    { id: 1, colorKey: 'one-mesh', origin, quantized: 'required', lod: true }, 'bucket', {
      budgetMs: 0, now: () => ++clock,
      yieldControl: async () => {
        await setImmediate();
        if (created.length === 0 && numericReads > 0) partialReads.push(numericReads);
      },
    });
  const distinctPartialReads = [...new Set(partialReads)].filter(reads => reads < numericReads);
  assert.ok(distinctPartialReads.length >= 2,
    `single-mesh CPU work must progress between yields; partial reads=${partialReads}, total=${numericReads}`);
});

it('aborts during CPU preparation before allocating or publishing GPU resources', async () => {
  const controller = new AbortController();
  const { device, created } = captureDevice();
  let clock = 0;
  await assert.rejects(createSceneBatchAsync([grid(150)], color, device, pipeline,
    { id: 1, colorKey: 'cancel-cpu', origin, quantized: 'required', lod: true }, 'bucket', {
      budgetMs: 0, now: () => ++clock, signal: controller.signal,
      yieldControl: async () => { await setImmediate(); controller.abort(); },
    }), error => error instanceof Error && error.name === 'AbortError');
  assert.equal(created.length, 0);
});

it('rolls back already allocated GPU resources if cancellation arrives during upload', async () => {
  const controller = new AbortController();
  const { device, created } = captureDevice(() => controller.abort());
  await assert.rejects(createSceneBatchAsync([grid(5)], color, device, pipeline,
    { id: 1, colorKey: 'cancel-upload', origin, quantized: 'off', lod: false }, undefined,
    { signal: controller.signal }), error => error instanceof Error && error.name === 'AbortError');
  assert.ok(created.length > 0, 'GPU upload boundary was reached');
  assertReleased(device, created);
});

it('cancellation after uniform allocation returns the arena slot and frees batch buffers', async () => {
  const controller = new AbortController();
  const { device, created } = captureDevice();
  await assert.rejects(createSceneBatchAsync([grid(5)], color, device, pipeline,
    { id: 1, colorKey: 'cancel-uniform', origin, quantized: 'off', lod: false }, undefined, {
      signal: controller.signal, budgetMs: 0,
      yieldControl: async () => {
        if (meshUniformArena(device, pipeline.getUniformBufferSize()).liveSlots > 0) controller.abort();
      },
    }), error => error instanceof Error && error.name === 'AbortError');
  assert.ok(created.some(buffer => (buffer.usage & GPUBufferUsage.UNIFORM) !== 0), 'uniform allocation was reached');
  assertReleased(device, created);
});

it('rejects an already aborted batch without allocating any resource', async () => {
  const controller = new AbortController();
  controller.abort();
  const { device, created } = captureDevice();
  await assert.rejects(createSceneBatchAsync([grid(5)], color, device, pipeline,
    { id: 1, colorKey: 'pre-cancel', origin, quantized: 'off', lod: false }, undefined,
    { signal: controller.signal }), error => error instanceof Error && error.name === 'AbortError');
  assert.equal(created.length, 0);
});

it('keeps asynchronous scratch isolated from overlapping synchronous and asynchronous uploads', async () => {
  const meshes = [grid(100)];
  const options = { id: 1, colorKey: 'lease', origin, quantized: 'off' as const, lod: true };
  const oracle = captureDevice();
  createSceneBatch(meshes, color, oracle.device, pipeline, options, 'bucket');
  const actual = captureDevice();
  let clock = 0, overlaps = 0;
  await createSceneBatchAsync(meshes, color, actual.device, pipeline, options, 'bucket', {
    budgetMs: 0, now: () => ++clock,
    yieldControl: async () => {
      if (overlaps++ > 2) return;
      const otherMesh = grid(100, 1234);
      otherMesh.positions.fill(12);
      const other = captureDevice();
      createSceneBatch([otherMesh], color, other.device, pipeline, { ...options, lod: false });
      await createSceneBatchAsync([otherMesh], color, other.device, pipeline, { ...options, lod: false });
      other.created.forEach(buffer => buffer.destroy());
    },
  });
  assert.ok(overlaps > 2);
  assert.deepEqual(bytes(actual.created), bytes(oracle.created));
});

it('async preparation reserves a unique batch identity before an overlapping synchronous upload', async () => {
  const scene = new Scene();
  let overlap: BatchedMesh | undefined;
  let entered = false;
  const { device, created } = captureDevice(() => {
    if (entered) return;
    entered = true;
    overlap = scene['createBatchedMesh']([grid(2, 314)], color, device, pipeline, 'overlap');
  });
  const prepared = await scene['createBatchedMeshAsync']([grid(100)], color, device, pipeline,
    'preparing', new AbortController().signal, 0);
  assert.ok(overlap, 'a synchronous upload ran after asynchronous GPU preparation began');
  assert.notEqual(prepared.id, overlap.id, 'independent batches cannot share draw/cache identity');
  assert.equal(scene['nextBatchId'], Math.max(prepared.id, overlap.id) + 1);
  destroyGpuResources(prepared);
  destroyGpuResources(overlap);
  assertReleased(device, created);
});

it('clearing Scene while a large finalization yields rejects and releases every buffer', async () => {
  const scene = new Scene();
  const { device, created } = captureDevice();
  scene.appendToBatches([grid(150)], device, pipeline, true);
  assert.ok(scene.hasStreamingFragments());
  const pending = scene.finalizeStreamingAsync(device, pipeline, 0);
  assert.ok(scene.isFinalizeInProgress());
  scene.clear();
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
  assert.equal(scene.isFinalizeInProgress(), false);
  assert.equal(scene.hasStreamingFragments(), false);
  assert.equal(scene.getBatchedMeshes().length, 0);
  assertReleased(device, created);
});

it('clearing Scene after preparation resolves cannot publish the completed uncommitted batch', async () => {
  const scene = new Scene();
  const { device, created } = captureDevice();
  scene.appendToBatches([grid(150)], device, pipeline, true);
  const prepare = scene['createBatchedMeshAsync'].bind(scene);
  scene['createBatchedMeshAsync'] = async (...args) => {
    const batch = await prepare(...args);
    // The GPU operation has committed, but the owner has not registered it.
    // This forces clear into the real Promise continuation boundary.
    queueMicrotask(() => scene.clear());
    return batch;
  };
  await assert.rejects(scene.finalizeStreamingAsync(device, pipeline, 0),
    error => error instanceof Error && error.name === 'AbortError');
  assert.equal(scene.getBatchedMeshes().length, 0);
  assert.equal(scene.isFinalizeInProgress(), false);
  assertReleased(device, created);
});

function evictedGrid() {
  // Nhip FPS regression (2026-10-26): a nominal six-millisecond restore
  // synchronously rebuilt a complete quantized/LOD batch and blocked input.
  const scene = new Scene();
  const capture = captureDevice();
  scene.setLodBuildsEnabled(true);
  scene.setQuantizedBatches(true);
  scene.appendToBatches([grid(40)], capture.device, pipeline, false);
  const batch = scene.getBatchedMeshes()[0];
  assert.ok(batch);
  scene.setGpuResidencyBudget(1);
  for (let i = 0; i < 31; i++) scene.beginResidencyFrame();
  scene.enforceGpuBudget();
  assert.equal(batch.gpuResident, false);
  scene.requestBatchResidency(batch);
  return { scene, batch, ...capture };
}

it('Nhip GPU residency restore yields before publication and preserves exact geometry bytes', async () => {
  const { scene, batch, device } = evictedGrid();
  const originalVertex = Array.from((batch.vertexBuffer as unknown as CapturedBuffer).contents);
  const originalIndex = Array.from((batch.indexBuffer as unknown as CapturedBuffer).contents);
  assert.equal(scene.processResidencyRestores(device, pipeline, 0), 0,
    'the live animation callback must not finish a complete batch synchronously');
  assert.equal(scene.getBatchedMeshes()[0], batch, 'keep the evicted shell until preparation commits');
  let restored = 0;
  for (let i = 0; i < 500 && scene.hasResidencyRestoreWork(); i++) {
    await yieldTask(0);
    restored += scene.processResidencyRestores(device, pipeline, 0);
  }
  assert.equal(restored, 1);
  assert.equal(scene.hasResidencyRestoreWork(), false);
  const actual = scene.getBatchedMeshes()[0];
  assert.notEqual(actual, batch);
  assert.deepEqual(Array.from((actual.vertexBuffer as unknown as CapturedBuffer).contents), originalVertex);
  assert.deepEqual(Array.from((actual.indexBuffer as unknown as CapturedBuffer).contents), originalIndex);
  for (const key of ['indexCount', 'lod1IndexCount', 'origin', 'bounds', 'expressIds', 'modelIndices', 'quantized'] as const) {
    assert.deepEqual(actual[key], batch[key], key);
  }
  scene.clear();
});

it('Nhip GPU restore cannot publish old geometry after Scene is cleared', async () => {
  const { scene, device, created } = evictedGrid();
  const initial = created.length;
  assert.equal(scene.processResidencyRestores(device, pipeline, 0), 0);
  scene.clear();
  await yieldTask(10);
  assert.equal(scene.hasResidencyRestoreWork(), false);
  assert.equal(scene.getBatchedMeshes().length, 0);
  assertReleased(device, created, false);
  assertReleased(device, created.slice(initial));
});

it('Nhip restore releases a completed unpublished upload when Scene clears at the Promise boundary', async () => {
  const { scene, device, created } = evictedGrid();
  const initial = created.length;
  const build = scene['createBatchedMeshAsync'].bind(scene);
  scene['createBatchedMeshAsync'] = async (...args) => {
    const result = await build(...args);
    queueMicrotask(() => scene.clear());
    return result;
  };
  scene.processResidencyRestores(device, pipeline, 0);
  for (let i = 0; i < 500 && scene.hasResidencyRestoreWork(); i++) {
    await yieldTask(0);
    scene.processResidencyRestores(device, pipeline, 0);
  }
  await yieldTask(0);
  assert.equal(scene.getBatchedMeshes().length, 0);
  assert.ok(created.slice(initial).length > 0, 'actual GPU preparation reached completion');
  assertReleased(device, created.slice(initial));
});
