/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from '@/store';
import { getDefaultSectionPlane } from '@/store/slices/sectionSlice';
import type { CameraViewpoint } from '@/store/types';
import { FakeFrameScheduler } from '@/components/viewport-ui/scene/test/scene-test-support';
import { fixtureModel } from '@/test/store-fixture';
import { loadLastSectionMode } from '@/store/slices/sectionLastMode';
import { beginBoxDraw, cancelBoxDraw, finishBoxDraw, useTestIfcBoxUi } from './testifc-box-controller';

const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 10, z: 20 } };
const originalPose: CameraViewpoint = { position: { x: 30, y: 25, z: 30 }, target: { x: 10, y: 5, z: 10 },
  up: { x: 0, y: 1, z: 0 }, projectionMode: 'perspective', fov: 45 };
let pose: CameraViewpoint, fitted: number, modes: string[], scheduler: FakeFrameScheduler;
const originalRequest = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
const state = () => useViewerStore.getState();
const settle = () => { for (let i = 0; i < 5; i++) scheduler.flush(); };
beforeEach(() => {
  cancelBoxDraw();
  pose = structuredClone(originalPose); fitted = 0; modes = [];
  scheduler = new FakeFrameScheduler();
  globalThis.requestAnimationFrame = scheduler.request;
  globalThis.cancelAnimationFrame = scheduler.cancel;
  useTestIfcBoxUi.setState({ phase: 'idle', error: null });
  useViewerStore.setState({ activeTool: 'section', sectionPlane: getDefaultSectionPlane(), sectionPickMode: false,
    models: new Map(), geometryResult: null, interactionMode: 'all', cameraCallbacks: {
      getViewpoint: () => structuredClone(pose),
      applyViewpoint: next => { pose = structuredClone(next); },
      setPresetView: () => { pose = { ...pose, position: { x: 10, y: 40, z: 10 }, target: { x: 10, y: 5, z: 10 }, projectionMode: 'orthographic', orthoSize: 20 }; },
      unprojectToFloor: (x, y, height) => ({ x, y: height, z: y }),
      setInteractionMode: mode => modes.push(mode), frameSectionBox: () => { fitted++; },
    } });
});
afterEach(() => {
  cancelBoxDraw(); globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel;
});

describe('TestIFC Box drawing transaction', () => {
  it('waits for Top to settle, cuts the swept footprint and restores the source orientation before fit', () => {
    assert.equal(beginBoxDraw(bounds), true);
    assert.equal(useTestIfcBoxUi.getState().phase, 'preparing');
    assert.equal(state().sectionPlane.enabled, false);
    assert.equal(finishBoxDraw({ x: 2, y: 2 }, { x: 12, y: 14 }), false, 'cannot draw through the view animation');
    settle();
    assert.equal(useTestIfcBoxUi.getState().phase, 'drawing');
    assert.equal(finishBoxDraw({ x: 2, y: 2 }, { x: 12, y: 14 }), true);
    assert.equal(state().sectionPlane.enabled, true);
    assert.deepEqual(state().sectionPlane.box, { min: [2, -.001, 2], max: [12, 10.001, 14] });
    assert.deepEqual(pose, originalPose);
    assert.equal(fitted, 0, 'restoring the camera must not start a second competing fit');
    assert.deepEqual(modes, ['none', 'all']);
    assert.equal(useTestIfcBoxUi.getState().phase, 'idle');
    assert.equal(scheduler.pending, 0);
  });
  it('a missed or tiny rectangle leaves drawing armed for another attempt', () => {
    beginBoxDraw(bounds); settle();
    assert.equal(finishBoxDraw({ x: 30, y: 30 }, { x: 40, y: 40 }), false);
    assert.equal(useTestIfcBoxUi.getState().phase, 'drawing');
    assert.equal(useTestIfcBoxUi.getState().error, 'testIfc.box.drawError');
    assert.equal(state().sectionPlane.enabled, false);
    assert.equal(finishBoxDraw({ x: 2, y: 2 }, { x: 3, y: 3 }), false);
    assert.equal(finishBoxDraw({ x: 2, y: 2 }, { x: 12, y: 14 }), true);
  });
  it('cancel restores an existing disabled box and exact camera, including during preparation', () => {
    state().setSectionBox({ min: [1, 2, 3], max: [9, 8, 7] });
    state().toggleSectionPlane();
    const before = structuredClone(state().sectionPlane);
    const lastMode = loadLastSectionMode();
    beginBoxDraw(bounds);
    cancelBoxDraw();
    assert.deepEqual(state().sectionPlane, before);
    assert.deepEqual(loadLastSectionMode(), lastMode);
    assert.deepEqual(pose, originalPose);
    settle();
    assert.equal(useTestIfcBoxUi.getState().phase, 'idle');
  });
  it('changing tools cancels drawing and does not leave a disabled placeholder box', () => {
    const before = structuredClone(state().sectionPlane);
    beginBoxDraw(bounds); settle();
    state().setActiveTool('select');
    assert.deepEqual(state().sectionPlane, before);
    assert.deepEqual(pose, originalPose);
    assert.equal(useTestIfcBoxUi.getState().phase, 'idle');
  });
  it('changing model scope cancels without writing stale bounds or camera into the new scene', () => {
    beginBoxDraw(bounds); settle();
    const nextPlane = getDefaultSectionPlane();
    useViewerStore.setState({ models: new Map([['next', fixtureModel('next')]]), sectionPlane: nextPlane });
    assert.equal(useTestIfcBoxUi.getState().phase, 'idle');
    assert.deepEqual(state().sectionPlane, nextPlane);
    assert.notDeepEqual(pose, originalPose, 'old scene pose must not be applied');
    assert.equal(finishBoxDraw({ x: 2, y: 2 }, { x: 12, y: 14 }), false);
  });
  it('leaving for a plane restores the camera but preserves the newly selected plane', () => {
    beginBoxDraw(bounds); settle();
    state().setSectionPlaneAxis('front');
    assert.equal(state().sectionPlane.box, undefined);
    assert.equal(state().sectionPlane.axis, 'front');
    assert.deepEqual(pose, originalPose);
    assert.equal(useTestIfcBoxUi.getState().phase, 'idle');
  });
  it('metadata-only model updates do not interrupt Top preparation or the sweep', () => {
    const model = fixtureModel('same');
    useViewerStore.setState({ models: new Map([['same', model]]) });
    beginBoxDraw(bounds);
    useViewerStore.setState({ models: new Map([['same', { ...model, name: 'Renamed model', collapsed: !model.collapsed }]]) });
    settle();
    assert.equal(useTestIfcBoxUi.getState().phase, 'drawing');
    assert.equal(finishBoxDraw({ x: 2, y: 2 }, { x: 12, y: 14 }), true);
  });
  it('unsupported camera or invalid bounds cannot mutate clipping', () => {
    const before = structuredClone(state().sectionPlane);
    assert.equal(beginBoxDraw(null), false);
    useViewerStore.setState({ cameraCallbacks: {} });
    assert.equal(beginBoxDraw(bounds), false);
    assert.deepEqual(state().sectionPlane, before);
  });
});
