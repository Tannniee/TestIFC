/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type ModelDropAction = 'add' | 'replace';
export type FileDropPoint = { clientX: number; clientY: number };
type DropBounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

/** Only an explicit drop inside the lower card replaces the current scene. */
export function modelDropAction(point?: FileDropPoint, replaceBounds?: DropBounds): ModelDropAction {
  return point && replaceBounds
    && point.clientX >= replaceBounds.left && point.clientX <= replaceBounds.right
    && point.clientY >= replaceBounds.top && point.clientY <= replaceBounds.bottom
    ? 'replace' : 'add';
}
