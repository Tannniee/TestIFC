/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** One quiet period for every camera writer: pointer, wheel, touch, keys,
 * SpaceMouse, presets and damping. Pointer release never upgrades quality. */
export const NAVIGATION_CLEAR_DELAY_MS = 250;

export class NavigationRenderQuality {
  private matrix: Float32Array;
  private lastMotionAt = -Infinity;
  private lowDetail = false;

  constructor(initialMatrix: Float32Array) {
    this.matrix = initialMatrix.slice();
  }

  frame(now: number, matrix: Float32Array, animating: boolean, fastView: boolean) {
    const moved = matrix.some((value, i) => value !== this.matrix[i]);
    if (moved) this.matrix.set(matrix);
    if (moved || animating) this.lastMotionAt = now;
    const lowDetail = fastView || now - this.lastMotionAt < NAVIGATION_CLEAR_DELAY_MS;
    const requestRender = moved || lowDetail !== this.lowDetail;
    this.lowDetail = lowDetail;
    return { lowDetail, requestRender };
  }
}
