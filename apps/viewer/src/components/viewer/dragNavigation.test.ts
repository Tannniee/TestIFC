/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '@ifc-lite/renderer';
import { useViewerStore } from '@/store';
import { applyDragNavigation } from './dragNavigation';

const initialPreset = useViewerStore.getState().navigationPreset;
afterEach(() => useViewerStore.setState({ navigationPreset: initialPreset }));

function camera(profile: 'ifclite' | 'testifc') {
  const result = new Camera();
  result.setPosition(0, 0, 10);
  result.setTarget(0, 0, 0);
  result.configureNavigation(profile, 600);
  return result;
}

// Brief 01: a shared mouse/touch helper must not change the other presets
// when adopting TestIFC's queued, time-based motion contract.
it('standard orbit consumes its drag immediately, with the upstream orbit result', () => {
  useViewerStore.setState({ navigationPreset: 'default' });
  const actual = camera('ifclite'), expected = camera('ifclite');
  expected.orbit(20, 5, false);
  applyDragNavigation(actual, 'orbit', 20, 5);
  assert.deepEqual(actual.getPosition(), expected.getPosition());
  assert.equal(actual.update(16), false, 'no deferred standard drag remains');
});

it('TestIFC orbit moves on animation frames, then settles without inventing momentum', () => {
  useViewerStore.setState({ navigationPreset: 'testifc' });
  const actual = camera('testifc');
  const before = actual.getPosition();
  applyDragNavigation(actual, 'orbit', 20, 5);
  assert.deepEqual(actual.getPosition(), before, 'the input handler queues displacement');
  assert.equal(actual.update(1000 / 60), true);
  assert.notDeepEqual(actual.getPosition(), before);
  let frames = 0;
  while (actual.update(1000 / 60) && frames < 120) frames++;
  assert.ok(frames < 120, 'the queued displacement settles within two seconds');
  const settled = actual.getPosition();
  assert.equal(actual.update(1000 / 60), false);
  assert.deepEqual(actual.getPosition(), settled);
});

it('pan retains immediate standard motion and queued TestIFC motion', () => {
  const standard = camera('ifclite');
  const before = standard.getTarget();
  useViewerStore.setState({ navigationPreset: 'default' });
  applyDragNavigation(standard, 'pan', 20, 5);
  assert.notDeepEqual(standard.getTarget(), before);
  const native = camera('testifc');
  const nativeBefore = native.getTarget();
  useViewerStore.setState({ navigationPreset: 'testifc' });
  applyDragNavigation(native, 'pan', 20, 5);
  assert.deepEqual(native.getTarget(), nativeBefore);
  assert.equal(native.update(1000 / 60), true);
  assert.notDeepEqual(native.getTarget(), nativeBefore);
});
