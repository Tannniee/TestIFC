/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ClipBox, ExtraClipPlane, Vec3 } from './types.js';

/** Options for GPU picking/selection, matching rendered visibility. */
export interface PickOptions {
  isStreaming?: boolean;
  hiddenIds?: Set<number>;
  isolatedIds?: Set<number> | null;
  /** Complete world-space broad-phase candidates, in the scene's global ID
   * space. Return undefined when indexes are missing/stale to use a full scan;
   * an empty set means the ray misses. Visibility and exact triangles still apply. */
  raycastCandidates?: (origin: Vec3, direction: Vec3) => ReadonlySet<number> | undefined;
}

/** Clip state the GPU picker mirrors from the most recent rendered frame. */
export interface PickClipState {
  sectionPlane?: { normal: [number, number, number]; distance: number; flipped: boolean } | null;
  /** Further planes (#7545), world-space; the picker clips against all of them. */
  extraPlanes?: readonly ExtraClipPlane[] | null;
  clipBox?: ClipBox | null;
}
