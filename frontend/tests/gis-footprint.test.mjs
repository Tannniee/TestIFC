import test from "node:test";
import assert from "node:assert/strict";
import { footprintCoordinates } from "../src/lib/gis-footprint.ts";

const bounds = { minEast: -10, maxEast: 10, minNorth: -5, maxNorth: 5,
  minHeight: 0, maxHeight: 20 };
const anchor = { longitude: 105.8, latitude: 21, elevationMeters: 0,
  rotationDegrees: 0, scale: 1 };

test("footprint centers the model bounds on a manual anchor in meters", () => {
  const ring = footprintCoordinates(anchor, bounds);
  assert.ok(ring);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  const center = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2];
  assert.ok(Math.abs(center[0] - anchor.longitude) < 1e-7);
  assert.ok(Math.abs(center[1] - anchor.latitude) < 1e-7);
  const eastMeters = (ring[1][0] - ring[0][0]) * 111320 * Math.cos(anchor.latitude * Math.PI / 180);
  assert.ok(Math.abs(eastMeters - 20) < 0.1);
});

test("rotation and scale alter projected corners without moving the anchor", () => {
  const ring = footprintCoordinates({ ...anchor, rotationDegrees: 90, scale: 2 }, bounds);
  assert.ok(ring);
  const eastMeters = (ring[1][0] - ring[0][0]) * 111320 * Math.cos(anchor.latitude * Math.PI / 180);
  const northMeters = (ring[1][1] - ring[0][1]) * 111320;
  assert.ok(Math.abs(eastMeters) < 0.1);
  assert.ok(Math.abs(northMeters + 40) < 0.1);
});

test("footprint rejects invalid and dateline crossing geometry", () => {
  assert.equal(footprintCoordinates(anchor, { ...bounds, maxEast: NaN }), null);
  assert.equal(footprintCoordinates({ ...anchor, longitude: 179.99999 }, bounds), null);
  assert.equal(footprintCoordinates({ ...anchor, latitude: 90 }, bounds), null);
});
