/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, click, cleanup } from '@/test/render.js';
import { useViewerStore } from '@/store';
import { TestIfcQuickTools } from './TestIfcQuickTools.js';

afterEach(cleanup);
test('quick tools gate empty models and share selection/measurement state with the ribbon', () => {
  useViewerStore.setState({ models: new Map(), geometryResult: null, navigationPreset: 'default',
    activeTool: 'select', testIfcOrbitMode: 'model' });
  const ui = render(<TestIfcQuickTools />);
  const button = (mode: string) => ui.querySelector<HTMLButtonElement>(`[data-quick-tool="${mode}"]`)!;
  assert.equal(button('selection').disabled, true);
  assert.equal(button('measure').disabled, true);
  click(button('model'));
  assert.equal(useViewerStore.getState().navigationPreset, 'testifc');
  assert.equal(useViewerStore.getState().projectionMode, 'orthographic');
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
  act(() => useViewerStore.setState({ geometryResult: { meshes: [], totalVertices: 0, totalTriangles: 0,
    coordinateInfo: { originShift: { x: 0, y: 0, z: 0 }, originalBounds: bounds, shiftedBounds: bounds, hasLargeCoordinates: false } } }));
  click(button('selection'));
  assert.equal(useViewerStore.getState().testIfcOrbitMode, 'selection');
  click(button('multi'));
  assert.equal(useViewerStore.getState().testIfcOrbitMode, 'multi');
  click(button('measure'));
  assert.equal(useViewerStore.getState().activeTool, 'measure');
  assert.equal(useViewerStore.getState().measureMode, 'drag');
  const polyline = [...ui.querySelectorAll<HTMLButtonElement>('.testifc-quick-tools__options button')].find(b => b.textContent === 'Polyline')!;
  click(polyline);
  assert.equal(useViewerStore.getState().measureMode, 'polyline');
  act(() => useViewerStore.getState().setActiveTool('section'));
  assert.equal(button('measure').getAttribute('aria-pressed'), 'false');
  assert.equal(ui.querySelector('.testifc-quick-tools__options'), null);
});
