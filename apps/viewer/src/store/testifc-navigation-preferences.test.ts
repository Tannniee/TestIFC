/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInitialNavigationPreset, persistNavigationPreset } from './slices/uiPreferences.js';

test('TestIFC is the initial profile; switching back to the original profile persists', () => {
  localStorage.clear();
  assert.equal(getInitialNavigationPreset(), 'testifc');
  persistNavigationPreset('default');
  assert.equal(getInitialNavigationPreset(), 'default');
  localStorage.clear();
  localStorage.setItem('ifc-lite-navigation-preset', 'default');
  assert.equal(getInitialNavigationPreset(), 'testifc');
  persistNavigationPreset('default');
  assert.equal(getInitialNavigationPreset(), 'default');
  localStorage.clear();
  localStorage.setItem('ifc-lite-navigation-preset', 'trackpad');
  assert.equal(getInitialNavigationPreset(), 'trackpad');
});
