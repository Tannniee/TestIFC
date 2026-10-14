/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { CameraInternalState } from './camera-state.js';
import { CAMERA_CONSTANTS as CC } from './constants.js';

/** TestIFC's OrbitControls response, expressed in the native camera's units.
 * It changes input behavior, never the IFC/viewer coordinate convention. */
export class CameraNavigationResponse {
  profile: 'ifclite' | 'testifc' = 'ifclite';
  height = 800;
  configure(profile: 'ifclite' | 'testifc', height: number): void {
    this.profile = profile;
    if (Number.isFinite(height) && height > 0) this.height = height;
  }
  get dampingMs(): number { return this.profile === 'testifc' ? -1000 / (60 * Math.log(.92)) : 60; }
  get orbitScale(): number { return this.profile === 'testifc' ? 2 * Math.PI / (this.height * CC.ORBIT_SENSITIVITY) : 1; }
  panScale(state: CameraInternalState): number {
    if (this.profile !== 'testifc') return 1;
    const a = state.camera.position, b = state.camera.target;
    const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (!Number.isFinite(distance) || distance <= 1e-6) return 0;
    const span = state.projectionMode === 'orthographic' ? 2 * state.orthoSize
      : 2 * distance * Math.tan(state.camera.fov / 2);
    return span / (this.height * distance * CC.PAN_SPEED_MULTIPLIER);
  }
  zoomFactor(delta: number): number | undefined {
    return this.profile === 'testifc' ? Math.pow(.95, -delta * .01) : undefined;
  }
}
