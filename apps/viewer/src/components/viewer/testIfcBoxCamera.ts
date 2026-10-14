/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Camera } from '@ifc-lite/renderer';
import { useViewerStore } from '@/store';

/** Native fit policy keeps the restored view orientation and projection. */
export function frameCurrentSectionBox(camera: Camera, render: () => void, scale: () => void): void {
  const box = useViewerStore.getState().sectionPlane.box;
  if (!box) return;
  void camera.frameBounds(
    { x: box.min[0], y: box.min[1], z: box.min[2] },
    { x: box.max[0], y: box.max[1], z: box.max[2] },
    420,
  );
  render();
  scale();
}
