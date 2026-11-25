/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { MathUtils } from './math.js';
import { composeInstanceMatrix, prepareInstancedRender, SWAP_ZUP_TO_YUP, INSTANCE_STRIDE_BYTES } from './instanced-render.js';
import { packRteOrigin, splitFloat64ForRte, tryPackRteDrawableDelta } from './relative-to-eye.js';

// PVF responsiveness: packing must retain the old two-stage f32 arithmetic,
// including source-f64 residuals at national-grid origins. No geometry shortcuts.
it('packs instance matrices identically to the two matrix multiplications', () => {
  for (let sample = 0; sample < 256; sample++) {
    const rm = Float32Array.from({ length: 16 }, (_, k) => Math.sin(sample * 19 + k) * 3);
    const origin: [number, number, number] = [6_000_000 + sample / 128, -2_000_000 - sample / 256, sample * 0.013];
    const rel = { m: Float32Array.from({ length: 16 }, (_, k) => rm[(k % 4) * 4 + Math.floor(k / 4)]) };
    const translation = MathUtils.identity();
    translation.m.set(origin, 12);
    const expected = MathUtils.multiply(SWAP_ZUP_TO_YUP, MathUtils.multiply(rel, translation)).m;
    assert.deepEqual(composeInstanceMatrix(rm, origin), expected);
    const [packed] = prepareInstancedRender({
      carriesItemIds: false,
      templates: [{ origin, positions: new Float32Array([0, 0, 0]), normals: new Float32Array([0, 0, 1]), indices: new Uint32Array([0, 0, 0]) }],
      instances: [{ templateIndex: 0, entityId: 1608, transform: rm, color: [0.2, 0.3, 0.4, 1] }],
    });
    assert.equal(packed.instanceBuffer.byteLength, INSTANCE_STRIDE_BYTES);
    assert.deepEqual(new Float32Array(packed.instanceBuffer, 0, 16), expected);
    const x = rm[0] * origin[0] + rm[1] * origin[1] + rm[2] * origin[2] + rm[3];
    const y = rm[4] * origin[0] + rm[5] * origin[1] + rm[6] * origin[2] + rm[7];
    const z = rm[8] * origin[0] + rm[9] * origin[1] + rm[10] * origin[2] + rm[11];
    assert.deepEqual([...packed.canonicalAnchors], [x, z, -y]);
    assert.deepEqual([...packed.canonicalMatrixTranslations], [...expected.subarray(12, 15)]);
  }
});

it('reused RTE staging preserves high/low lanes across moving national-grid cameras', () => {
  const out = new Float32Array(12).fill(17);
  const origin: [number, number, number] = [8_000_000.015625, -5_000_000.03125, 100.125];
  for (let sample = 0; sample < 256; sample++) {
    const camera: [number, number, number] = [8_000_000 + sample / 128, -5_000_000 - sample / 128, sample / 128];
    assert.equal(tryPackRteDrawableDelta(origin, camera, out, 2), true);
    const split = origin.map((value, axis) => splitFloat64ForRte(value - camera[axis]));
    assert.deepEqual([...out.subarray(2, 10)], [split[0][0], split[1][0], split[2][0], 0, split[0][1], split[1][1], split[2][1], 0]);
    assert.deepEqual([...out.subarray(0, 2)], [17, 17]);
    assert.deepEqual([...out.subarray(10)], [17, 17]);
  }
  const before = out.slice();
  assert.equal(tryPackRteDrawableDelta(origin, [0, 0, 0], out, 2), false);
  assert.deepEqual(out, before);
  assert.throws(() => tryPackRteDrawableDelta([Infinity, 0, 0], [0, 0, 0], out, 2), RangeError);
  assert.throws(() => packRteOrigin(origin, new Float32Array(7)), RangeError);
});
