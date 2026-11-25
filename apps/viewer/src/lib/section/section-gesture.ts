/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether a section gesture (a box face-handle drag) moved the cut just now.
 * The animation loop reads it once per frame and renders those frames like
 * camera navigation: reduced resolution and no post effects, then one full
 * frame after the quiet period. A full-quality frame per pointer move on a
 * multi-million-triangle model was the remaining stall of a box drag.
 *
 * It is a timestamp, not an on/off flag: a gesture that ends without its
 * release reaching us (lost capture, unmount) cannot leave the viewport stuck
 * in reduced quality.
 */

/** A move older than this no longer counts as motion. */
export const SECTION_GESTURE_HOLD_MS = 100;

let lastMoveAt = -Infinity;

/** Record that a gesture just moved the cut. */
export function noteSectionGestureMove(now = performance.now()): void {
  lastMoveAt = now;
}

/** Whether a gesture moved the cut within the last {@link SECTION_GESTURE_HOLD_MS}. */
export function sectionGestureMoving(now = performance.now()): boolean {
  return now - lastMoveAt < SECTION_GESTURE_HOLD_MS;
}
