/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from './camera.js';
import { OrbitDamping } from './camera-orbit-damping.js';

// Regression: rotation felt stepped despite steady WebView2 frame delivery.
test('damping conserves displacement and responds equally at different refresh rates', () => {
  function run(step: number) {
    const damping = new OrbitDamping();
    damping.add(100, -25);
    let x = 0, y = 0;
    const apply = (dx: number, dy: number) => { x += dx; y += dy; return true; };
    for (let elapsed = 0; elapsed < 100; elapsed += step) damping.step(step, apply);
    const at100 = x;
    for (let elapsed = 100; elapsed < 1000; elapsed += step) damping.step(step, apply);
    assert.ok(Math.abs(x - 100) < 1e-8);
    assert.ok(Math.abs(y + 25) < 1e-8);
    assert.equal(damping.step(step, apply), false);
    return at100;
  }
  assert.ok(Math.abs(run(5) - run(20)) < 1e-8);
});

test('smoothed native orbit continues across frames and settles at the direct orbit pose', () => {
  const smooth = new Camera(), direct = new Camera();
  const before = smooth.getPosition();
  smooth.orbitSmoothed(40, -15);
  assert.deepEqual(smooth.getPosition(), before);
  assert.equal(smooth.update(16), true);
  const first = smooth.getPosition();
  assert.equal(smooth.update(16), true);
  assert.notDeepEqual(smooth.getPosition(), first);
  for (let i = 0; i < 100; i++) smooth.update(16);
  direct.orbit(40, -15);
  const actual = smooth.getPosition(), expected = direct.getPosition();
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) < 1e-6);
  assert.equal(smooth.update(16), false);
});

test('reset, explicit pose and interaction restrictions discard pending orbit', () => {
  for (const interrupt of [
    (c: Camera) => c.reset(), (c: Camera) => c.stopInertia(),
    (c: Camera) => c.setPosition(10, 20, 30),
    (c: Camera) => c.setInteractionMode('none'),
  ]) {
    const camera = new Camera();
    camera.orbitSmoothed(80, 20);
    interrupt(camera);
    const position = camera.getPosition();
    camera.setInteractionMode('all');
    for (let i = 0; i < 100; i++) camera.update(16);
    assert.deepEqual(camera.getPosition(), position);
  }
  const camera = new Camera();
  camera.setInteractionMode('pan');
  camera.orbitSmoothed(80, 20);
  camera.setInteractionMode('all');
  camera.orbitSmoothed(NaN, 2);
  assert.equal(camera.update(16), false);
});

test('damped horizontal orbit retains the native external pivot and radius', () => {
  const smooth = new Camera(), direct = new Camera();
  const pivot = { x: 8, y: 2, z: 10 };
  smooth.setOrbitCenter(pivot);
  direct.setOrbitCenter(pivot);
  const initial = smooth.getPosition();
  const radius = Math.hypot(initial.x - pivot.x, initial.y - pivot.y, initial.z - pivot.z);
  smooth.orbitSmoothed(50, 0);
  for (let i = 0; i < 100; i++) {
    smooth.update(16);
    const p = smooth.getPosition();
    assert.ok(Math.abs(Math.hypot(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z) - radius) < 1e-8);
  }
  direct.orbit(50, 0);
  for (const [actual, expected] of [[smooth.getPosition(), direct.getPosition()], [smooth.getTarget(), direct.getTarget()]]) {
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) < 1e-6);
  }
});
