import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { modelMercatorMatrix, georeferencedMercatorMatrix } from "../src/lib/gis-placement.ts";

const bounds = { minEast: -10, maxEast: 10, minNorth: -5, maxNorth: 5,
  minHeight: -2, maxHeight: 18 };
const anchor = { longitude: 0, latitude: 0, elevationMeters: 10,
  rotationDegrees: 0, scale: 1 };
const origin = { x: 0.5, y: 0.5, z: 0.01, meterScale: 0.000001 };
const place = (point, options = anchor) => point.clone().applyMatrix4(modelMercatorMatrix(options, bounds, origin));

test("model center bottom maps to anchor altitude and viewer axes map east/south/up", () => {
  const center = place(new THREE.Vector3(0, -2, 0));
  assert.ok(center.distanceTo(new THREE.Vector3(0.5, 0.5, 0.01)) < 1e-12);
  const east = place(new THREE.Vector3(1, -2, 0)).sub(center);
  const north = place(new THREE.Vector3(0, -2, -1)).sub(center);
  const up = place(new THREE.Vector3(0, -1, 0)).sub(center);
  assert.ok(east.distanceTo(new THREE.Vector3(1e-6, 0, 0)) < 1e-12);
  assert.ok(north.distanceTo(new THREE.Vector3(0, -1e-6, 0)) < 1e-12);
  assert.ok(up.distanceTo(new THREE.Vector3(0, 0, 1e-6)) < 1e-12);
});

test("clockwise rotation and scale move east toward south", () => {
  const options = { ...anchor, rotationDegrees: 90, scale: 2 };
  const center = place(new THREE.Vector3(0, -2, 0), options);
  const east = place(new THREE.Vector3(1, -2, 0), options).sub(center);
  assert.ok(east.distanceTo(new THREE.Vector3(0, 2e-6, 0)) < 1e-12);
});

test("IFC control points undo the Fragments coordinate shift once", () => {
  const origin = { x: 0.5, y: 0.5, z: 0.01 };
  const scale = 1e-6;
  const controls = {
    origin,
    east: { x: origin.x + scale, y: origin.y, z: origin.z },
    north: { x: origin.x, y: origin.y - scale, z: origin.z },
    up: { x: origin.x, y: origin.y, z: origin.z + scale },
  };
  const shift = new THREE.Matrix4().makeTranslation(0.1, -4, -0.005);
  const placement = georeferencedMercatorMatrix(controls, shift);
  const transformedOrigin = new THREE.Vector3(0.1, -4, -0.005).applyMatrix4(placement);
  assert.ok(transformedOrigin.distanceTo(new THREE.Vector3(0.5, 0.5, 0.01)) < 1e-12);
  const north = new THREE.Vector3(0.1, -4, -1.005).applyMatrix4(placement);
  assert.ok(north.distanceTo(new THREE.Vector3(0.5, 0.5 - scale, 0.01)) < 1e-12);
});
