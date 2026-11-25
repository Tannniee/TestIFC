/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from './scene.js';
import type { DecodedInstancedShard, MeshData } from '@ifc-lite/geometry';
import { Camera } from './camera.js';
import { PickingManager } from './picking-manager.js';
import type { Picker } from './picker.js';

const origin = { x: 0, y: 0, z: 0 }, direction = { x: 0, y: 0, z: -1 };
const ids = (...values: number[]) => new Set(values);
function triangle(expressId: number, z: number, modelIndex = 0, x = 0): MeshData {
  return { expressId, modelIndex, geometryItemId: expressId + 100,
    positions: new Float32Array([x - 1, -1, z, x + 1, -1, z, x, 1, z]),
    normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), color: [1, 1, 1, 1] };
}

// desktop FPS regression: a ray candidate set must bound the exact pick's work,
// not merely run another BVH before the same whole-model scan.
it('tests only supplied ray candidates while retaining the nearest exact surface (desktop FPS)', () => {
  const scene = new Scene();
  scene.addMeshData(triangle(1, -4)); scene.addMeshData(triangle(2, -8, 1));
  scene.addMeshData(triangle(3, -3, 0, 20));
  const exhaustive = scene.raycast(origin, direction);
  const lookup = scene.getEntityBoundingBox.bind(scene);
  scene.getEntityBoundingBox = id => {
    assert.notEqual(id, 3, 'an off-ray entity must not enter the narrow phase');
    return lookup(id);
  };
  assert.deepEqual(scene.raycast(origin, direction, undefined, null, null, ids(2, 1)), exhaustive);
  assert.equal(scene.raycast(origin, direction, undefined, null, null, ids()), null);
  assert.equal(scene.raycast(origin, direction, new Set([1]), null, null, ids(1, 2))?.expressId, 2);
  assert.equal(scene.raycast(origin, direction, undefined, new Set([2]), null, ids(1, 2))?.modelIndex, 1);
  assert.equal(scene.raycast(origin, direction, undefined, null,
    { sectionPlane: { normal: [0, 0, 1], distance: -6, flipped: false } }, ids(1, 2))?.expressId, 2);
});

it('keeps all pieces of a candidate and preserves representation item IDs (desktop FPS)', () => {
  const scene = new Scene();
  scene.addMeshData(triangle(8, -12));
  const near = triangle(8, -3); near.geometryItemId = 903;
  scene.addMeshData(near);
  scene.addMeshData(triangle(10, -6, 1));
  const hit = scene.raycast(origin, direction, undefined, null, null, ids(10, 8));
  assert.equal(hit?.expressId, 8); assert.equal(hit?.geometryItemId, 903); assert.equal(hit?.distance, 3);
  assert.deepEqual(hit, scene.raycast(origin, direction));
});

it('preserves insertion priority for coincident surfaces regardless of BVH order (desktop FPS)', () => {
  const scene = new Scene();
  scene.addMeshData(triangle(90, -4)); scene.addMeshData(triangle(2, -4));
  assert.equal(scene.raycast(origin, direction)?.expressId, 90);
  assert.deepEqual(scene.raycast(origin, direction, undefined, null, null, ids(2, 90)), scene.raycast(origin, direction));
  scene.releaseGeometryData();
  assert.equal(scene.isGeometryDataReleased(), true);
  assert.deepEqual(scene.raycast(origin, direction, undefined, null, null, ids(2, 90)), scene.raycast(origin, direction));
});

it('forwards broad-phase candidates through the actual CPU picking route (desktop FPS)', async () => {
  const scene = new Scene(); scene.addMeshData(triangle(1, -4)); scene.addMeshData(triangle(3, -3, 0, 20));
  // Only the GPU hydration decision is stubbed. The hit is computed from the
  // real scene's triangles, and scanning unrelated geometry is forbidden.
  scene.getBatchedMeshes = () => [{}] as ReturnType<Scene['getBatchedMeshes']>;
  scene.isGeometryDataReleased = () => true;
  const lookup = scene.getEntityBoundingBox.bind(scene);
  scene.getEntityBoundingBox = id => { assert.notEqual(id, 3); return lookup(id); };
  const camera = new Camera(); camera.setPosition(0,0,0); camera.setTarget(0,0,-1); camera.setAspect(1);
  const canvas = { getBoundingClientRect: () => ({ width: 100, height: 100 }) } as HTMLCanvasElement;
  const picker = { pick: () => { throw new Error('Over-budget CPU pick must not issue a GPU readback'); } } as unknown as Picker;
  const manager = new PickingManager(camera, scene, picker, canvas, () => ({ ok: true, value: undefined }));
  assert.equal((await manager.pick(50,50,{raycastCandidates:()=>ids(1)}))?.expressId, 1);
});

it('retains exact instanced hits and model ownership with bounded candidates (desktop FPS)', () => {
  (globalThis as Record<string, unknown>).GPUBufferUsage = { COPY_DST: 8, INDEX: 16, VERTEX: 32 };
  const device = { limits: { maxBufferSize: 1<<30, maxStorageBufferBindingSize: 1<<30 },
    createBuffer: (desc: GPUBufferDescriptor) => ({ size: desc.size, getMappedRange: () => new ArrayBuffer(desc.size), unmap() {}, destroy() {} }),
    queue: { writeBuffer() {} } } as unknown as GPUDevice;
  const shard = (entityId: number, depth: number): DecodedInstancedShard => ({ carriesItemIds: false,
    templates: [{ positions: new Float32Array([-1,0,-1,1,0,-1,0,0,1]), normals: new Float32Array(9),
      indices: new Uint32Array([0,1,2]), origin:[0,0,0] }],
    instances: [{ entityId, templateIndex:0, color:[1,1,1,1],
      transform:new Float32Array([1,0,0,0,0,1,0,depth,0,0,1,0,0,0,0,1]) }] });
  const scene = new Scene();scene.addInstancedShard(device,shard(41,5),3);scene.addInstancedShard(device,shard(42,9),7);
  const full = scene.raycast(origin,direction);
  assert.equal(full?.expressId,41);assert.equal(full?.modelIndex,3);
  scene.addInstancedShard(device,shard(43,5),7);
  assert.deepEqual(scene.raycast(origin,direction,undefined,null,null,ids(43,42,41)),full);
  assert.deepEqual(scene.raycast(origin,direction,undefined,null,null,ids(41,42)),full);
  assert.equal(scene.raycast(origin,direction,new Set([41]),null,null,ids(41,42))?.modelIndex,7);
  assert.equal(scene.raycast(origin,direction,undefined,null,
    {sectionPlane:{normal:[0,0,1],distance:-7,flipped:false}},ids(41,42))?.expressId,42);
});
