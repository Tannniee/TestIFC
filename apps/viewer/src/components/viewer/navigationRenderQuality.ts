/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** One quiet period for every camera writer: pointer, wheel, touch, keys,
 * SpaceMouse, presets and damping. Pointer release never upgrades quality. */
export const NAVIGATION_CLEAR_DELAY_MS = 250;

/**
 * Relative difference below which two view-projection entries are the same
 * pose. Far below any visible camera step (a one-pixel orbit moves entries by
 * ~1e-3), far above the f32 noise of re-normalising the aspect.
 */
const POSE_EPSILON = 1e-5;

/**
 * Write the aspect-independent part of a column-major view-projection matrix.
 * Only the projection's x scale depends on the aspect (ortho 1/(h*aspect),
 * perspective f/aspect), and it scales row 0 alone, so row 0 times the aspect
 * is the same for one camera pose at any drawing-buffer shape.
 */
function writePose(target: Float64Array, matrix: Float32Array, aspect: number): void {
  const k = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  for (let i = 0; i < 16; i++) target[i] = i % 4 === 0 ? matrix[i] * k : matrix[i];
}

export class NavigationRenderQuality {
  private pose = new Float64Array(16);
  private next = new Float64Array(16);
  private lastMotionAt = -Infinity;
  private lowDetail = false;

  constructor(initialMatrix: Float32Array, aspect = 1) {
    writePose(this.pose, initialMatrix, aspect);
  }

  /**
   * `aspect` is the camera aspect the matrix was built with. Motion is a change
   * of camera pose or zoom, not of the drawing-buffer shape: low-detail frames
   * render at pixel ratio 1 and settled frames at the display ratio, and the
   * two buffers round to slightly different aspects. Counting that as motion
   * re-entered low detail on every settled frame, so an idle viewport kept
   * alternating between the two qualities.
   */
  frame(now: number, matrix: Float32Array, animating: boolean, fastView: boolean, aspect = 1) {
    writePose(this.next, matrix, aspect);
    let moved = false;
    for (let i = 0; i < 16; i++) {
      const a = this.next[i], b = this.pose[i];
      if (Math.abs(a - b) > POSE_EPSILON * Math.max(Math.abs(a), Math.abs(b), 1e-9)) { moved = true; break; }
    }
    if (moved) {
      // Swap the two scratch poses: the hot path allocates nothing per frame.
      const previous = this.pose;
      this.pose = this.next;
      this.next = previous;
    }
    if (moved || animating) this.lastMotionAt = now;
    const lowDetail = fastView || now - this.lastMotionAt < NAVIGATION_CLEAR_DELAY_MS;
    const requestRender = moved || lowDetail !== this.lowDetail;
    this.lowDetail = lowDetail;
    return { lowDetail, requestRender };
  }
}
