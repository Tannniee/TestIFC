/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { DecodedInstancedShard } from '@ifc-lite/geometry';
import { Scene } from './scene.js';

(globalThis as Record<string, unknown>).GPUBufferUsage = { COPY_DST: 8, INDEX: 16, VERTEX: 32 };
const device = {
  limits: { maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 1 << 30 },
  createBuffer: (desc: GPUBufferDescriptor) => {
    const data = new ArrayBuffer(desc.size);
    return { size: desc.size, getMappedRange: () => data, unmap() {}, destroy() {} };
  },
  queue: { writeBuffer() {} },
} as unknown as GPUDevice;

function shard(x: number): DecodedInstancedShard {
  return { carriesItemIds: false,
    templates: [{ positions: new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0.01]),
      normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), origin: [x, 0, 0] }],
    instances: [0, 2].map(dx => ({ templateIndex: 0, entityId: 41, color: [1, 1, 1, 1],
      transform: new Float32Array([1, 0, 0, dx, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) })),
  };
}

it('scopes compact bounds to a renderer owner even when global entity IDs overlap', () => {
  const scene = new Scene();
  scene.addInstancedShard(device, shard(5_000_000.125), 3);
  scene.addInstancedShard(device, shard(10), 4);
  scene.getAllInstancedMeshData = () => { throw new Error('Bounds must not expand vertices'); };
  const own = scene.getInstancedEntityBounds(41, 3)!;
  assert.equal(own.min.x, 5_000_000.125);
  assert.equal(own.max.x, 5_000_002.125 + Math.fround(0.01));
  assert.equal(scene.getInstancedEntityBounds(41, 4)!.min.x, 10);
  assert.equal(scene.getInstancedEntityBounds(41, 5), null);
  assert.equal(scene.getInstancedEntityBounds(41)!.min.x, 10, 'unscoped query retains the combined cache');

  scene.setModelTranslation(3, [10, 20, 30]);
  assert.equal(scene.getInstancedEntityBounds(41, 3)!.min.x, 5_000_010.125);
  assert.equal(scene.getInstancedEntityBounds(41, 4)!.min.x, 10, 'moving one owner leaves its peer intact');
  scene.removeInstancedTemplatesForModel(3);
  assert.equal(scene.getInstancedEntityBounds(41, 3), null);
  assert.equal(scene.getInstancedEntityBounds(41, 4)!.min.x, 10);
});

it('bounds contain rotated and translated occurrences with source-f64 anchors', () => {
  const scene = new Scene();
  scene.addInstancedShard(device, shard(5_000_000.125), 3);
  scene.setModelRotation(3, Math.PI / 3, [5_000_000.125, 0, 0]);
  scene.setModelTranslation(3, [0.125, 2, -3]);
  const bounds = scene.getInstancedEntityBounds(41, 3)!;
  for (const piece of scene.getInstancedMeshDataPieces(41)!) {
    for (let i = 0; i < piece.positions.length; i += 3) {
      for (const [axis, lane] of [['x', 0], ['y', 1], ['z', 2]] as const) {
        const world = piece.positions[i + lane] + piece.origin![lane];
        assert.ok(world >= bounds.min[axis] - 1e-7 && world <= bounds.max[axis] + 1e-7,
          `world ${axis}=${world} must lie in its owner's broad-phase box`);
      }
    }
  }
});

it('includes f32-rounded local extrema in the compact broad-phase box', () => {
  const scene = new Scene(), large = shard(5_000_000.125);
  large.templates[0].positions = Float32Array.from(Array.from({ length: 8 }, (_, corner) =>
    [corner & 1 ? 8192 : 0, corner & 2 ? 8192 : 0, corner & 4 ? 8192 : 0]).flat());
  large.templates[0].normals = new Float32Array(24);
  scene.addInstancedShard(device, large, 3);
  scene.setModelRotation(3, Math.PI / 3, [5_000_000.125, 0, 0]);
  const bounds = scene.getInstancedEntityBounds(41, 3)!;
  for (const piece of scene.getInstancedMeshDataPieces(41)!) for (let i = 0; i < piece.positions.length; i += 3) {
    for (const [axis, lane] of [['x', 0], ['y', 1], ['z', 2]] as const) {
      const world = piece.positions[i + lane] + piece.origin![lane];
      assert.ok(world >= bounds.min[axis] && world <= bounds.max[axis], `rounded ${axis} escaped its box`);
    }
  }
});
