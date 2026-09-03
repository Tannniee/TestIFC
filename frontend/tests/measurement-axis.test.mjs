import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MEASURE_AXES, snapMeasurementAxis } from "../src/lib/measurement-axis.ts";

test("all six signed engineering axis directions snap in screen space", () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100);
  camera.position.set(8, 6, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const origin = new THREE.Vector3();
  for (const axis of MEASURE_AXES) for (const sign of [-1, 1]) {
    const pixel = axis.direction.clone().multiplyScalar(1.5 * sign).project(camera);
    const hit = snapMeasurementAxis(origin, 2, camera, 600, 600, (pixel.x + 1) * 300, (1 - pixel.y) * 300);
    assert.equal(hit.axis, axis.name);
    assert.ok(hit.point.clone().normalize().distanceTo(axis.direction.clone().multiplyScalar(sign)) < 1e-9);
  }
  assert.equal(snapMeasurementAxis(origin, 2, camera, 600, 600, 300, 300), null);
  assert.equal(snapMeasurementAxis(origin, 2, camera, 600, 600, 10, 10), null);
});

test("an axis viewed end-on is not an arbitrary fixed-distance direction", () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  assert.equal(snapMeasurementAxis(new THREE.Vector3(), 2, camera, 600, 600, 302, 301), null);
  assert.equal(snapMeasurementAxis(new THREE.Vector3(), 2, camera, 600, 600, 350, 300).axis, "X");
});
