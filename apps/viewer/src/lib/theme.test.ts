/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDarkTheme, nextToggleTheme, persistTheme } from './theme';
import { getThemeClearColor } from '@/utils/viewportUtils';
import { resolveDrawingPaperTheme } from '@/components/viewer/drawing/paper-theme';

afterEach(() => {
  localStorage.removeItem('ifc-lite-theme');
  localStorage.removeItem('ifc-lite-dark-theme');
});

it('recognizes both dark palettes and ignores a stale dark preference', () => {
  assert.equal(isDarkTheme('oled'), true);
  assert.equal(isDarkTheme('dark'), true);
  assert.equal(isDarkTheme('light'), false);
  localStorage.setItem('ifc-lite-dark-theme', 'invalid');
  assert.equal(nextToggleTheme('light'), 'dark');
});

it('remembers OLED across light, colorful and a later dark palette change', () => {
  persistTheme('oled');
  persistTheme('light');
  assert.equal(nextToggleTheme('light'), 'oled');
  persistTheme('colorful');
  assert.equal(nextToggleTheme('colorful'), 'oled');
  persistTheme('dark');
  assert.equal(nextToggleTheme('light'), 'dark');
  assert.equal(nextToggleTheme('oled'), 'light');
});

it('uses opaque black for the GPU and drawing while print preview stays white', () => {
  assert.deepEqual(getThemeClearColor('oled'), [0, 0, 0, 1]);
  const drawing = resolveDrawingPaperTheme('oled', false);
  assert.equal(drawing.paper, '#000000');
  assert.equal(drawing.desk, '#000000');
  assert.equal(drawing.isDark, true);
  assert.equal(resolveDrawingPaperTheme('oled', true).paper, '#ffffff');
});
