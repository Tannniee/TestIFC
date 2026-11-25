/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeGeometryStream } from '../../../../../desktop/native-geometry-stream';
import { decodeInstancedShard } from '@ifc-lite/geometry';

function shared(): ArrayBuffer {
  const result = new ArrayBuffer(32 + 48 + 92 + 36 + 12), view = new DataView(result);
  [0x49464e53, 2, 1, 1, 9, 0, 3, 92].forEach((word, i) => view.setUint32(i * 4, word, true));
  [0, 9, 0, 0, 0, 3].forEach((word, i) => view.setUint32(32 + i * 4, word, true));
  view.setUint32(84, 7, true);
  [1, 1, 1, 1].forEach((v, i) => view.setFloat32(88 + i * 4, v, true));
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) => view.setFloat32(104 + i * 4, v, true));
  view.setUint32(168, 51, true);
  new Float32Array(result, 172, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint32Array(result, 208, 3).set([0, 1, 2]);
  return result;
}
function bounds(id = 7): ArrayBuffer {
  const bytes = new ArrayBuffer(64), view = new DataView(bytes);
  [0x42434649, 1, 1, id].forEach((word, i) => view.setUint32(i * 4, word, true));
  [0, 0, -1, 1, 0, 0].forEach((v, i) => view.setFloat64(16 + i * 8, v, true));
  return bytes;
}

test('native shards retain item identity, receive deferred color and restore absolute Y-up bounds', () => {
  const stream = new NativeGeometryStream();
  stream.accept(shared()); stream.accept(bounds());
  stream.finish(1, { flatMeshes: 0, instancedOccurrences: 1, instancedTemplates: 1 }, [600000, 1200000, 42],
    new Map([[7, [0.25, 0.5, 0.75, 1]]]));
  assert.equal(stream.meshes.length, 0, 'no materialized occurrence geometry in the UI');
  assert.deepEqual(stream.aabbs.get(7), { min: [600000, 42, -1200001], max: [600001, 42, -1200000] });
  const decoded = decodeInstancedShard(stream.shards[0]);
  assert.equal(decoded.instances[0].itemId, 51);
  assert.deepEqual(decoded.instances[0].color, [0.25, 0.5, 0.75, 1]);
  assert.deepEqual(Array.from(decoded.templates[0].indices), [0, 1, 2]);
});

test('missing or mismatched instanced geometry bounds cannot pass completion', () => {
  for (const id of [undefined, 8]) {
    const stream = new NativeGeometryStream(); stream.accept(shared());
    if (id !== undefined) stream.accept(bounds(id));
    assert.throws(() => stream.finish(1, {}, [0, 0, 0], new Map()), /Incomplete/);
  }
  const stream = new NativeGeometryStream(); stream.accept(shared()); stream.accept(bounds());
  assert.throws(() => stream.finish(2, {}, [0, 0, 0], new Map()), /Incomplete/);
  assert.throws(() => stream.accept(bounds().slice(0, 60)), /Truncated/);
  assert.throws(() => stream.accept(new ArrayBuffer(4)), /Unknown/);
});
