// SPDX-License-Identifier: MPL-2.0
import { OrbitDamping } from './camera-orbit-damping.js';
import { CameraNavigationResponse } from './camera-navigation.js';
import { isUsableDistance } from './camera-guards.js';
import type { CameraAnimator } from './camera-animation.js';
import type { CameraControls } from './camera-controls.js';
import type { CameraInternalState } from './camera-state.js';
import type { InteractionMode } from './camera-controls.js';
import type { Vec3 } from './types.js';

/** Pointer damping owns only pending gesture displacement, never camera poses. */
export class CameraNavigationMotion {
  readonly response = new CameraNavigationResponse();
  private readonly orbit = new OrbitDamping();
  private readonly pan = new OrbitDamping();

  clear(): void { this.orbit.clear(); this.pan.clear(); }

  configure(profile: 'ifclite' | 'testifc', height: number, animator: CameraAnimator): void {
    if (profile !== this.response.profile) { this.clear(); animator.reset(); }
    this.response.configure(profile, height);
    animator.testIfcNavigation = profile === 'testifc';
    this.orbit.timeConstantMs = this.pan.timeConstantMs = this.response.dampingMs;
  }

  queuePan(x: number, y: number, mode: InteractionMode, distance: number, animator: CameraAnimator): void {
    if (!this.usable(x, y, distance) || mode === 'orbit' || mode === 'none') return;
    animator.reset(); this.orbit.clear(); this.pan.add(x, y);
  }

  queueOrbit(x: number, y: number, mode: InteractionMode, distance: number, target: Vec3, animator: CameraAnimator): void {
    if (!this.usable(x, y, distance) || mode === 'pan' || mode === 'none') return;
    if (![target.x, target.y, target.z].every(Number.isFinite)) return;
    animator.reset(); this.pan.clear();
    this.orbit.add(x * this.response.orbitScale, y * this.response.orbitScale);
  }

  step(deltaTime: number, controls: CameraControls, state: CameraInternalState): boolean {
    const orbiting = this.orbit.step(deltaTime, (x, y) => controls.orbit(x, y));
    const panning = this.pan.step(deltaTime, (x, y) => {
      const scale = this.response.panScale(state);
      return controls.pan(x * scale, y * scale, this.response.profile === 'testifc');
    });
    return orbiting || panning;
  }

  applyOrbit(x: number, y: number, inertia: boolean, controls: CameraControls, animator: CameraAnimator): void {
    if (!controls.orbit(x, y)) return;
    this.clear(); animator.resetPresetTracking();
    if (inertia) animator.addOrbitVelocity(x, y);
  }

  applyPan(x: number, y: number, inertia: boolean, distance: number, controls: CameraControls, state: CameraInternalState, animator: CameraAnimator): void {
    const scale = this.response.panScale(state);
    if (!controls.pan(x * scale, y * scale, this.response.profile === 'testifc')) return;
    this.clear();
    if (inertia && isUsableDistance(distance, 0)) animator.addPanVelocity(x, y, distance * 0.001);
  }

  private usable(x: number, y: number, distance: number): boolean {
    return Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0) && isUsableDistance(distance, 1e-6);
  }
}
