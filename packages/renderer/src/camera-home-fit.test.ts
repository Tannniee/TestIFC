/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Camera } from './camera.js';
import type { Bounds3 } from './camera-fit-policy.js';

const building: Bounds3 = { min: { x: -30, y: 0, z: -20 }, max: { x: 30, y: 25, z: 20 } };

function assertFits(camera: Camera, bounds: Bounds3, width: number, height: number) {
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = camera.projectToScreen({ x, y, z }, width, height);
        assert.ok(point, `corner ${x},${y},${z} projects in front of the camera`);
        assert.ok(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height,
          `corner ${x},${y},${z} at ${JSON.stringify(point)} must fit ${width}x${height}`);
      }
    }
  }
}

function withClock(run: (advance: (ms: number) => void) => void) {
  const originalNow = Date.now;
  const hadRaf = Object.hasOwn(globalThis, 'requestAnimationFrame');
  const originalRaf = Reflect.get(globalThis, 'requestAnimationFrame');
  let now = 1000;
  Date.now = () => now;
  Reflect.set(globalThis, 'requestAnimationFrame', () => 0);
  try { run(ms => { now += ms; }); }
  finally {
    Date.now = originalNow;
    if (hadRaf) Reflect.set(globalThis, 'requestAnimationFrame', originalRaf);
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  }
}

describe('Home whole-scene fit', () => {
  it('restoring a viewpoint interpolates its scale and orientation in one transition', () => {
    withClock(advance => {
      const camera = new Camera();
      camera.configureNavigation('testifc', 700);
      camera.setProjectionMode('orthographic'); camera.setOrthoSize(2);
      camera.setPosition(0, 20, 0); camera.setTarget(0, 0, 0);
      void camera.animateToWithUp({ x: 20, y: 10, z: 20 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 300, 12);
      assert.equal(camera.getOrthoSize(), 2, 'scale is continuous at the first frame');
      advance(100); camera.update(16);
      assert.ok(camera.getOrthoSize() > 2 && camera.getOrthoSize() < 12, 'intermediate scale');
      advance(5000); camera.update(16);
      assert.equal(camera.getOrthoSize(), 12);
      assert.deepEqual(camera.getPosition(), { x: 20, y: 10, z: 20 });
    });
  });
  it('fits an orthographic building after either extreme zoom, including a narrow viewport', () => {
    for (const [width, height] of [[1200, 700], [300, 1000]]) {
      for (const zoom of [0.1, 100000]) {
        const camera = new Camera();
        camera.setAspect(width / height);
        camera.setProjectionMode('orthographic');
        camera.setOrthoSize(zoom);
        camera.fitBoundsAdaptive(building);
        assertFits(camera, building, width, height);
        assert.notEqual(camera.getOrthoSize(), zoom);
      }
    }
  });
  it('fits perspective corners against both viewport dimensions', () => {
    const camera = new Camera();
    camera.setAspect(0.3);
    camera.fitBoundsAdaptive(building);
    assertFits(camera, building, 300, 1000);
  });
  it('animates the orthographic scale along with the Home pose', () => {
    withClock(advance => {
      const camera = new Camera();
      camera.configureNavigation('testifc', 700);
      camera.setAspect(1200 / 700);
      camera.setProjectionMode('orthographic');
      camera.setOrthoSize(0.1);
      camera.fitBoundsAdaptive(building, { animate: true, duration: 500 });
      assert.equal(camera.getOrthoSize(), 0.1, 'scale must not jump at animation start');
      advance(100);
      camera.update(16);
      const intermediate = camera.getOrthoSize();
      assert.ok(intermediate > 0.1, 'scale moves during the transition');
      advance(5000);
      camera.update(16);
      assert.ok(camera.getOrthoSize() > intermediate, 'scale reaches its final fit');
      assertFits(camera, building, 1200, 700);
    });
  });
  it('applies the fitted orthographic scale immediately for zero-duration animation', () => {
    const camera = new Camera();
    camera.setAspect(1200 / 700);
    camera.setProjectionMode('orthographic');
    camera.setOrthoSize(0.1);
    camera.fitBoundsAdaptive(building, { animate: true, duration: 0 });
    assertFits(camera, building, 1200, 700);
    assert.notEqual(camera.getOrthoSize(), 0.1);
  });
  it('wholeScene fits an elongated federation instead of a local infrastructure detail', () => {
    const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 1, z: 1 } };
    const camera = new Camera();
    camera.setAspect(0.3);
    assert.equal(camera.fitBoundsAdaptive(bounds).kind, 'linear', 'automatic infrastructure detail framing remains available');
    const policy = camera.fitBoundsAdaptive(bounds, { wholeScene: true });
    assert.equal(policy.kind, 'compact');
    assertFits(camera, bounds, 300, 1000);
  });
});
