/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_GESTURE_HOLD_MS, noteSectionGestureMove, sectionGestureMoving } from './section-gesture';

describe('section gesture motion', () => {
  it('counts as motion right after a move and expires on its own', () => {
    noteSectionGestureMove(1_000);
    assert.equal(sectionGestureMoving(1_000), true);
    assert.equal(sectionGestureMoving(1_000 + SECTION_GESTURE_HOLD_MS - 1), true);
    assert.equal(sectionGestureMoving(1_000 + SECTION_GESTURE_HOLD_MS), false,
      'a drag whose release never arrived cannot hold the viewport in reduced quality');
  });
});
