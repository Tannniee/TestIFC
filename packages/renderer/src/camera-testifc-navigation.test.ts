/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from './camera.js';
import { TestIfcCameraTransition } from './camera-testifc-transition.js';

function camera(height = 800) {
  const c = new Camera();
  c.configureNavigation('testifc', height);
  c.setAspect(1); c.setProjectionMode('orthographic');
  c.setOrthoSize(10); c.setPosition(0, 0, 20); c.setTarget(0, 0, 0);
  return c;
}
function settle(c: Camera, step = 16) { for (let elapsed = 0; elapsed < 2400; elapsed += step) c.update(step); }
function close(a: number, b: number) { assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`); }

test('TestIFC wheel keeps cursor point fixed, preserves distance and reverses exactly', () => {
  const c = camera(), point = { x: 4, y: 2, z: 0 };
  const pixel = c.projectToScreen(point, 800, 800)!;
  const before = { position: c.getPosition(), target: c.getTarget(), size: c.getOrthoSize() };
  c.zoom(-100, false, pixel.x, pixel.y, 800, 800);
  close(c.getDistance(), 20); close(c.getOrthoSize(), 9.5);
  const after = c.projectToScreen(point, 800, 800)!;
  close(after.x, pixel.x); close(after.y, pixel.y);
  c.zoom(100, false, pixel.x, pixel.y, 800, 800);
  close(c.getOrthoSize(), before.size);
  for (const axis of ['x', 'y', 'z'] as const) {
    close(c.getPosition()[axis], before.position[axis]); close(c.getTarget()[axis], before.target[axis]);
  }
});
test('TestIFC rotation follows viewport size and has the same endpoint at different refresh rates', () => {
  const a = camera(800), b = camera(1600), fast = camera(800);
  a.orbitSmoothed(100, 0); b.orbitSmoothed(200, 0); fast.orbitSmoothed(100, 0);
  settle(a); settle(b); settle(fast, 5);
  close(Math.atan2(a.getPosition().x, a.getPosition().z), -Math.PI / 4);
  for (const axis of ['x', 'y', 'z'] as const) {
    close(a.getPosition()[axis], b.getPosition()[axis]); close(a.getPosition()[axis], fast.getPosition()[axis]);
  }
  assert.deepEqual(a.getTarget(), { x: 0, y: 0, z: 0 });
});
test('TestIFC pan tracks screen pixels at different zoom levels and explicit poses cancel its tail', () => {
  for (const size of [2, 10, 30]) {
    const c = camera(); c.setOrthoSize(size);
    const point = { x: 0, y: 0, z: 0 }, before = c.projectToScreen(point, 800, 800)!;
    c.panSmoothed(100, 40); settle(c);
    const after = c.projectToScreen(point, 800, 800)!;
    close(after.x - before.x, 100); close(after.y - before.y, 40);
    c.panSmoothed(100, 40); c.setPosition(5, 10, 20);
    const position = c.getPosition(); settle(c); assert.deepEqual(c.getPosition(), position);
  }
});
test('TestIFC transitions preserve orbit radius, up vector and exact endpoint through opposite views', () => {
  const from = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
  const to = { ...from, position: { x: 0, y: 0, z: -10 } };
  const transition = TestIfcCameraTransition.create(from, to)!;
  const middle = transition.sample(.5);
  close(Math.hypot(middle.position.x, middle.position.y, middle.position.z), 10);
  close(Math.hypot(middle.up.x, middle.up.y, middle.up.z), 1);
  const end = transition.sample(1);
  for (const axis of ['x', 'y', 'z'] as const) close(end.position[axis], to.position[axis]);
  assert.ok(transition.duration(300, 1, 16) > 420);
});

test('TestIFC pan accumulates pointer movement across frames rather than dropping its remainder', () => {
  const c = camera(), point = { x: 0, y: 0, z: 0 };
  const before = c.projectToScreen(point, 800, 800)!;
  for (let i = 0; i < 10; i++) { c.panSmoothed(10, 4); c.update(16); }
  settle(c);
  const after = c.projectToScreen(point, 800, 800)!;
  close(after.x - before.x, 100); close(after.y - before.y, 40);
});

test('invalid or disallowed smoothed pan leaves a pending orbit intact', () => {
  const c = camera();
  c.orbitSmoothed(100, 0);
  c.panSmoothed(Number.NaN, 10); c.panSmoothed(0, 0);
  settle(c);
  close(Math.atan2(c.getPosition().x, c.getPosition().z), -Math.PI / 4);
  for (const mode of ['orbit', 'none'] as const) {
    const restricted = camera(); restricted.setInteractionMode(mode);
    const target = restricted.getTarget(); restricted.panSmoothed(50, 10); settle(restricted);
    assert.deepEqual(restricted.getTarget(), target);
  }
});
