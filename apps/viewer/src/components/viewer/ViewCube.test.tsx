/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, activate, cleanup } from '@/test/render';
import { ViewCube } from './ViewCube';
afterEach(cleanup);
test('keyboard controls select six native presets, Home and diagonal corner', () => {
  const views: string[] = [], corners: string[] = [];
  let homes = 0;
  const ui = render(<ViewCube onViewChange={v => views.push(v)} onHome={() => homes++}
    onDirection={d => corners.push(`${d.x}:${d.y}:${d.z}`)} />);
  assert.equal(ui.querySelectorAll('.view-cube__surface').length, 26);
  for (const button of ui.querySelectorAll<HTMLButtonElement>('.view-controls button:not(.home-view)')) activate(button);
  assert.deepEqual(views, ['left', 'right', 'top', 'bottom', 'front', 'back']);
  activate(ui.querySelector<HTMLButtonElement>('.home-view')!);
  activate(ui.querySelector<HTMLButtonElement>('[data-direction-key="1:1:1"]')!);
  assert.equal(homes, 1);
  assert.deepEqual(corners, ['1:1:1']);
});
test('disabled navigation leaves every button disabled', () => {
  const ui = render(<ViewCube disabled />);
  assert.ok([...ui.querySelectorAll<HTMLButtonElement>('button')].every(b => b.disabled));
});
