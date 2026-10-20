/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { InteractionRenderBudget } from './interactionRenderBudget.js';

it('allows a 13 ms scene to draw at the next available 100 Hz frame (desktop FPS)', () => {
  const budget = new InteractionRenderBudget();
  budget.rendered(0, 90, false); // Full-quality idle work must not poison a gesture.
  assert.equal(budget.shouldRender(10, true), true);
  for (let t = 10; t < 1000; t += 20) {
    assert.equal(budget.shouldRender(t, true), true);
    budget.rendered(t, 13, true);
  }
  assert.equal(budget.intervalMs, 0, 'no fixed 25/33 ms tier for an affordable moving frame');
});

it('yields briefly after an expensive moving frame and recovers on the next cheap frame (desktop FPS)', () => {
  const budget = new InteractionRenderBudget();
  budget.rendered(0, 60, true);
  assert.equal(budget.shouldRender(61, true), false);
  assert.equal(budget.shouldRender(68, true), true);
  assert.equal(budget.shouldRender(61, false), true, 'idle/recovery redraws are not throttled');
  budget.rendered(68, 13, true);
  assert.equal(budget.shouldRender(88, true), true);
  assert.equal(budget.intervalMs, 0);
});
