/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { cubeDirectionPose, cubeOrientation, namedCubeView } from './viewcube-camera';
import { VIEW_CUBE_QUICK_VIEWS, VIEW_CUBE_SURFACES, currentDirectionKey } from './viewcube-math';
import type { CameraViewpoint } from '@/store/types';

const pose: CameraViewpoint = { position: { x: 10, y: 20, z: 40 }, target: { x: 10, y: 20, z: 30 },
  up: { x: 0, y: 1, z: 0 }, fov: 60, projectionMode: 'orthographic', orthoSize: 15 };
test('all six quick controls use IFC-Lite Y-up, +Z front and +X right', () => {
  const expected = ['left', 'right', 'top', 'bottom', 'front', 'back'];
  assert.deepEqual(VIEW_CUBE_QUICK_VIEWS.map(v => namedCubeView(v.direction)), expected);
  assert.deepEqual(VIEW_CUBE_QUICK_VIEWS[2].direction, { x: 0, y: 1, z: 0 });
  assert.deepEqual(VIEW_CUBE_QUICK_VIEWS[4].direction, { x: 0, y: 0, z: 1 });
});
test('each of the 26 faces, edges and corners maps back to its real camera direction', () => {
  for (const surface of VIEW_CUBE_SURFACES) {
    const p = cubeDirectionPose(pose, surface.direction);
    // Keep the native renderer's small pole offset for top and bottom.
    if (Math.abs(surface.direction.y) === 1 && surface.direction.x === 0 && surface.direction.z === 0) p.position.z += .01;
    const q = cubeOrientation(0, 0, p);
    assert.equal(currentDirectionKey(q), surface.key);
    assert.equal(p.orthoSize, pose.orthoSize);
    assert.equal(p.projectionMode, pose.projectionMode);
    assert.deepEqual(p.target, pose.target);
  }
});
test('cube orientation follows camera roll as well as position', () => {
  const rolled = cubeOrientation(0, 0, { ...pose, up: { x: 1, y: 0, z: 0 } });
  const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(rolled.x, rolled.y, rolled.z, rolled.w));
  assert.ok(up.distanceTo(new Vector3(1, 0, 0)) < 1e-8);
  assert.equal(currentDirectionKey(rolled), '0:0:1');
});
