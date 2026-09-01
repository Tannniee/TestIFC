import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMeasurement,
  isFullyIncludedSweep,
  measurementInputToMeters,
  measurementMidpoint,
  parseMeasurementInput,
  pointAtDistance,
} from "../src/lib/viewer-tool-math.ts";

test("selection sweep direction follows CAD window and crossing conventions", () => {
  assert.equal(isFullyIncludedSweep(20, 80), true);
  assert.equal(isFullyIncludedSweep(80, 20), false);
});

test("measurements use readable engineering units", () => {
  assert.equal(formatMeasurement(2.3451), "2.345 m");
  assert.equal(formatMeasurement(0.125), "12.50 cm");
  assert.equal(formatMeasurement(0.0042), "4.2 mm");
});

test("measurement label midpoint stays centered in model space", () => {
  assert.deepEqual(measurementMidpoint({
    id: 1,
    mode: "pointToPoint",
    start: { x: -2, y: 1, z: 4 },
    end: { x: 6, y: 5, z: 10 },
    distance: 0,
  }), { x: 2, y: 3, z: 7 });
});

test("typed millimetres and metres convert to model metres", () => {
  assert.equal(measurementInputToMeters(1250, "mm"), 1.25);
  assert.equal(measurementInputToMeters(2.4, "m"), 2.4);
  assert.equal(Number.isNaN(measurementInputToMeters(0, "m")), true);
});

test("dynamic measurement input accepts a unit suffix or the selected default", () => {
  assert.deepEqual(parseMeasurementInput("5000mm", "m"), { distance: 5000, unit: "mm" });
  assert.deepEqual(parseMeasurementInput("5 m", "mm"), { distance: 5, unit: "m" });
  assert.deepEqual(parseMeasurementInput("2,5", "m"), { distance: 2.5, unit: "m" });
  assert.equal(parseMeasurementInput("0mm", "mm"), null);
  assert.equal(parseMeasurementInput("five", "m"), null);
});

test("exact distance keeps the snapped measurement direction", () => {
  assert.deepEqual(
    pointAtDistance({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 }, 10),
    { x: 7, y: 10, z: 3 },
  );
  assert.equal(pointAtDistance({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, 2), null);
});
