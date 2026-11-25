/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Clicking the same preset twice rotates it 90°, but only when the camera is
 * still on that preset. Any explicit pose tween in between (Home fit, a
 * viewpoint restore after a TestIFC Box draw, BCF) must start the cycle over,
 * or Top -> Home -> Top lands rotated a quarter turn.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from './camera.js';
import type { Vec3 } from './types.js';

const BOUNDS = { min: { x: -10, y: -2, z: -6 }, max: { x: 10, y: 2, z: 6 } };

function withStubbedFrameClock(run: (advance: (ms: number) => void) => void): void {
  const originalNow = Date.now;
  const hadRaf = Object.prototype.hasOwnProperty.call(globalThis, 'requestAnimationFrame');
  const originalRaf = Reflect.get(globalThis, 'requestAnimationFrame');
  let now = 1_000;
  Date.now = () => now;
  Reflect.set(globalThis, 'requestAnimationFrame', () => 0);
  try {
    run((ms) => { now += ms; });
  } finally {
    Date.now = originalNow;
    if (hadRaf) Reflect.set(globalThis, 'requestAnimationFrame', originalRaf);
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  }
}

function settle(camera: Camera, advance: (ms: number) => void): void {
  for (let i = 0; i < 120; i++) { advance(16); camera.update(16); }
}

const near = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;

function topUp(camera: Camera, advance: (ms: number) => void): Vec3 {
  camera.setPresetView('top', BOUNDS);
  settle(camera, advance);
  return { ...camera.getUp() };
}

describe('Camera preset cycle', () => {
  it('still rotates 90° when the same preset is chosen twice in a row', () => {
    withStubbedFrameClock((advance) => {
      const camera = new Camera();
      camera.setAspect(16 / 9);
      const first = topUp(camera, advance);
      const second = topUp(camera, advance);
      assert.ok(!near(first, second), 'a repeated Top click turns the plan');
    });
  });

  it('starts over after an explicit viewpoint tween (Box draw finish/cancel, BCF)', () => {
    withStubbedFrameClock((advance) => {
      const camera = new Camera();
      camera.setAspect(16 / 9);
      const first = topUp(camera, advance);
      void camera.animateToWithUp({ x: 30, y: 20, z: 30 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 300);
      settle(camera, advance);
      assert.ok(near(topUp(camera, advance), first), 'Top after a viewpoint restore is the unrotated Top');
    });
  });

  it('starts over after a Home fit', () => {
    withStubbedFrameClock((advance) => {
      const camera = new Camera();
      camera.setAspect(16 / 9);
      const first = topUp(camera, advance);
      void camera.applyFitPolicy({ kind: 'compact', aspect: 1, distance: Math.hypot(30, 20, 30),
        position: { x: 30, y: 20, z: 30 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } }, 300);
      settle(camera, advance);
      assert.ok(near(topUp(camera, advance), first), 'Top -> Home -> Top is the unrotated Top');
    });
  });
});
