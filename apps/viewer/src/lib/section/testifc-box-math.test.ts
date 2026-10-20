/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { boxFromSweep, boxDragAxis, editIfcBoxValue, ifcBoxValue } from './testifc-box-math';

const box = { min: [0, 1, -10] as [number, number, number], max: [20, 7, 0] as [number, number, number] };
describe('TestIFC box on IFC-Lite world axes', () => {
  it('shows IFC Y as -world Z with exchanged limits and IFC Z as world Y', () => {
    assert.equal(ifcBoxValue(box, 1, 'min'), 0);
    assert.equal(ifcBoxValue(box, 1, 'max'), 10);
    assert.equal(ifcBoxValue(box, 2, 'min'), 1);
    assert.deepEqual(editIfcBoxValue(box, 1, 'min', 3), { min: [0, 1, -10], max: [20, 7, -3] });
    assert.deepEqual(editIfcBoxValue(box, 2, 'max', 9), { min: [0, 1, -10], max: [20, 9, 0] });
  });
  it('rejects inverted, too thin and non-finite edits without changing the box', () => {
    assert.equal(editIfcBoxValue(box, 0, 'min', 21), null);
    assert.equal(editIfcBoxValue(box, 0, 'min', 19.99), null);
    assert.equal(editIfcBoxValue(box, 1, 'max', NaN), null);
    assert.equal(editIfcBoxValue(box, 2, 'max', Infinity), null);
  });
  it('uses all four rolled Top corners and the full model elevation', () => {
    const result = boxFromSweep([{ x: 3, y: 1, z: -5 }, { x: 7, y: 1, z: -9 }, { x: 11, y: 1, z: -5 }, { x: 7, y: 1, z: -1 }], box);
    assert.ok(result);
    assert.deepEqual([result.min[0], result.max[0], result.min[2], result.max[2]], [3, 11, -9, -1]);
    assert.ok(result.min[1] < 1 && result.max[1] > 7);
  });
  it('rejects a missing ray, degenerate footprint and a sweep outside the model', () => {
    assert.equal(boxFromSweep([null, null, null, null], box), null);
    assert.equal(boxFromSweep(Array(4).fill({ x: 3, y: 1, z: -5 }), box), null);
    assert.equal(boxFromSweep([{ x: 30, y: 1, z: -9 }, { x: 40, y: 1, z: -9 }, { x: 40, y: 1, z: -1 }, { x: 30, y: 1, z: -1 }], box), null);
  });
  it('projects positive-axis motion and uses vertical fallback for both edge-on sides', () => {
    assert.deepEqual(boxDragAxis('minX', { x: 20, y: 0 }, { x: 18, y: 0 }, 10, 600), { x: 1, y: -0, metersPerPixel: .5 });
    assert.deepEqual(boxDragAxis('maxY', { x: 20, y: 0 }, { x: 20, y: 0 }, 30, 600), { x: 0, y: -1, metersPerPixel: .05 });
    assert.deepEqual(boxDragAxis('minY', { x: 20, y: 0 }, { x: 20, y: 0 }, 30, 600), { x: 0, y: -1, metersPerPixel: .05 });
  });
});
