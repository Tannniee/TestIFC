/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION_CLEAR_DELAY_MS, NavigationRenderQuality } from './navigationRenderQuality';

/** Column-major orthographic view-projection for one fixed camera pose. */
function orthoViewProj(aspect: number, halfHeight = 72.6, offsetX = 0): Float32Array {
  // A rotated view with a translation, as an isometric Home view has.
  const view = [
    0.7071, -0.4082, 0.5774, 0,
    0, 0.8165, 0.5774, 0,
    -0.7071, -0.4082, 0.5774, 0,
    -40 + offsetX, 12, -150, 1,
  ];
  const sx = 1 / (halfHeight * aspect), sy = 1 / halfHeight, sz = -0.004, tz = 0.6;
  const m = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    m[col * 4] = sx * view[col * 4];
    m[col * 4 + 1] = sy * view[col * 4 + 1];
    m[col * 4 + 2] = sz * view[col * 4 + 2] + tz * view[col * 4 + 3];
    m[col * 4 + 3] = view[col * 4 + 3];
  }
  return m;
}

describe('NavigationRenderQuality', () => {
  it('stays at full quality when only the drawing-buffer aspect changes', () => {
    // 1726x1140 CSS px: ratio 1 vs 1.25 rounds to two different aspects.
    const lowAspect = 1726 / 1140, fullAspect = Math.round(1726 * 1.25) / Math.round(1140 * 1.25);
    assert.notEqual(lowAspect, fullAspect);
    const quality = new NavigationRenderQuality(orthoViewProj(fullAspect), fullAspect);
    let t = 1000;
    let state = quality.frame(t, orthoViewProj(fullAspect), false, false, fullAspect);
    assert.equal(state.lowDetail, false);
    // Alternate the two buffer shapes as low-detail and settled frames do.
    for (let i = 0; i < 20; i++) {
      t += 16;
      const aspect = i % 2 ? fullAspect : lowAspect;
      state = quality.frame(t, orthoViewProj(aspect), false, false, aspect);
      assert.equal(state.lowDetail, false, `frame ${i}: an aspect change is not navigation`);
      assert.equal(state.requestRender, false, `frame ${i}: an idle viewport asks for no frame`);
    }
  });

  it('drops to low detail on real motion and settles after the quiet period', () => {
    const aspect = 1.5;
    const quality = new NavigationRenderQuality(orthoViewProj(aspect), aspect);
    const moved = quality.frame(1000, orthoViewProj(aspect, 72.6, 0.5), false, false, aspect);
    assert.deepEqual(moved, { lowDetail: true, requestRender: true }, 'a pan is motion');
    const zoomed = quality.frame(1016, orthoViewProj(aspect, 70, 0.5), false, false, aspect);
    assert.equal(zoomed.lowDetail, true, 'an orthographic zoom is motion');
    assert.equal(zoomed.requestRender, true);
    const still = quality.frame(1016 + NAVIGATION_CLEAR_DELAY_MS - 1, orthoViewProj(aspect, 70, 0.5), false, false, aspect);
    assert.equal(still.lowDetail, true, 'still inside the quiet period');
    const settled = quality.frame(1016 + NAVIGATION_CLEAR_DELAY_MS, orthoViewProj(aspect, 70, 0.5), false, false, aspect);
    assert.deepEqual(settled, { lowDetail: false, requestRender: true }, 'one settled full-quality frame');
    const idle = quality.frame(1016 + NAVIGATION_CLEAR_DELAY_MS + 16, orthoViewProj(aspect, 70, 0.5), false, false, aspect);
    assert.deepEqual(idle, { lowDetail: false, requestRender: false });
  });

  it('keeps fast view low detail and counts animation as motion', () => {
    const aspect = 1.5;
    const quality = new NavigationRenderQuality(orthoViewProj(aspect), aspect);
    assert.equal(quality.frame(1000, orthoViewProj(aspect), false, true, aspect).lowDetail, true);
    const fresh = new NavigationRenderQuality(orthoViewProj(aspect), aspect);
    assert.equal(fresh.frame(1000, orthoViewProj(aspect), true, false, aspect).lowDetail, true);
  });
});
