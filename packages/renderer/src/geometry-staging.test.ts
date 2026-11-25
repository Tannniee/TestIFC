/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryStagingPool } from './geometry-staging.js';
import { mergeGeometry } from './scene-geometry.js';
import type { MeshData } from '@ifc-lite/geometry';

it('holds asynchronous scratch across overlapping uploads and releases it after failure', async () => {
  const pool = new GeometryStagingPool(1024);
  let held: ArrayBuffer | undefined, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = pool.useAsync(async allocate => {
    held = allocate('vertices', 128); new Uint8Array(held).fill(77);
    await gate;
    assert.ok(new Uint8Array(held).every(v => v === 77));
    throw Error('cancelled');
  });
  pool.use(allocate => { const other = allocate('vertices', 128); assert.notEqual(other, held); new Uint8Array(other).fill(12); });
  await pool.useAsync(async allocate => { const other = allocate('vertices', 128); assert.notEqual(other, held); new Uint8Array(other).fill(15); });
  release(); await assert.rejects(pending, /cancelled/);
  pool.use(allocate => assert.equal(allocate('vertices', 128), held));
});

const mesh = (id: number): MeshData => ({ expressId: id, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), color: [1, 0.5, 0, 1], origin: [6_000_000.015625, 1, 2] });

it('reuses upload staging while retaining the exact mesh bytes and view lengths', () => {
  const pool = new GeometryStagingPool(1024);
  const meshes = [mesh(123), mesh(456)];
  const origin: [number, number, number] = [6_000_000, 0, 0];
  const expected = mergeGeometry(meshes, origin);
  let first: ArrayBufferLike | undefined;
  pool.use(allocate => {
    const actual = mergeGeometry(meshes, origin, allocate);
    assert.deepEqual(actual, expected);
    first = actual.vertexData.buffer;
  });
  const smaller = mergeGeometry([meshes[1]], origin);
  pool.use(allocate => {
    const actual = mergeGeometry([meshes[1]], origin, allocate);
    assert.equal(actual.vertexData.buffer, first);
    assert.equal(actual.vertexData.byteLength, smaller.vertexData.byteLength);
    assert.deepEqual([...actual.vertexData], [...smaller.vertexData]);
    assert.deepEqual([...actual.indices], [...smaller.indices]);
    assert.deepEqual(actual.bounds, smaller.bounds);
  });
  assert.deepEqual([...meshes[0].positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

it('isolates nested uploads, releases a failed lease, and does not retain oversized staging', () => {
  const pool = new GeometryStagingPool(128);
  let first: ArrayBuffer | undefined;
  pool.use(allocate => {
    first = allocate('vertices', 128);
    new Uint8Array(first).fill(17);
    pool.use(inner => { const nested = inner('vertices', 128); new Uint8Array(nested).fill(31); assert.notEqual(nested, first); });
    assert.ok(new Uint8Array(first).every(value => value === 17));
    assert.notEqual(allocate('vertices', 256), allocate('vertices', 256));
  });
  assert.throws(() => pool.use(() => { throw Error('upload refused'); }));
  pool.use(allocate => assert.equal(allocate('vertices', 128), first));
});
