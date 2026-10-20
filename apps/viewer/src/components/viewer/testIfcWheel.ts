/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Camera } from '@ifc-lite/renderer';
export function applyTestIfcWheel(camera: Camera, canvas: HTMLCanvasElement, event: WheelEvent, fixedCenter: boolean): void {
  const rect = canvas.getBoundingClientRect();
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
  const delta = event.deltaY * units * (event.ctrlKey ? 10 : 1);
  camera.zoom(delta, false, fixedCenter ? undefined : event.clientX - rect.left,
    fixedCenter ? undefined : event.clientY - rect.top, rect.width, rect.height);
}
