/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Vec3 } from './types.js';
type Quaternion = [number, number, number, number];
interface Pose { position: Vec3; target: Vec3; up: Vec3 }
const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = (v: Vec3): Vec3 => { const n = length(v); return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function orientation(pose: Pose): Quaternion | null {
  const back = sub(pose.position, pose.target);
  if (!Number.isFinite(length(back)) || length(back) < 1e-10) return null;
  const z = normalize(back), right = cross(pose.up, z);
  if (!Number.isFinite(length(right)) || length(right) < 1e-10) return null;
  const x = normalize(right), y = cross(z, x), trace = x.x + y.y + z.z;
  let q: Quaternion;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(y.z - z.y) / s, (z.x - x.z) / s, (x.y - y.x) / s, s / 4];
  } else if (x.x > y.y && x.x > z.z) {
    const s = Math.sqrt(1 + x.x - y.y - z.z) * 2;
    q = [s / 4, (y.x + x.y) / s, (z.x + x.z) / s, (y.z - z.y) / s];
  } else if (y.y > z.z) {
    const s = Math.sqrt(1 + y.y - x.x - z.z) * 2;
    q = [(y.x + x.y) / s, s / 4, (z.y + y.z) / s, (z.x - x.z) / s];
  } else {
    const s = Math.sqrt(1 + z.z - x.x - y.y) * 2;
    q = [(z.x + x.z) / s, (z.y + y.z) / s, s / 4, (x.y - y.x) / s];
  }
  return q;
}
function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  if (dot < 0) { b = b.map(v => -v) as Quaternion; dot = -dot; }
  let weights: [number, number];
  if (dot > .9995) weights = [1 - t, t];
  else {
    const angle = Math.acos(Math.min(1, dot)), sin = Math.sin(angle);
    weights = [Math.sin((1 - t) * angle) / sin, Math.sin(t * angle) / sin];
  }
  const q = a.map((v, i) => v * weights[0] + b[i] * weights[1]) as Quaternion;
  const n = Math.hypot(...q);
  return q.map(v => v / n) as Quaternion;
}
export class TestIfcCameraTransition {
  private constructor(private from: Pose, private to: Pose, private a: Quaternion, private b: Quaternion) {}
  static create(from: Pose, to: Pose): TestIfcCameraTransition | null {
    const a = orientation(from), b = orientation(to);
    return a && b ? new TestIfcCameraTransition(structuredClone(from), structuredClone(to), a, b) : null;
  }
  duration(base: number, fromHeight: number, toHeight: number): number {
    const dot = this.a.reduce((sum, v, i) => sum + v * this.b[i], 0);
    const rotation = 2 * Math.acos(Math.min(1, Math.abs(dot))) / Math.PI * 120;
    const octaves = fromHeight > 0 && toHeight > 0 ? Math.max(0, Math.log2(toHeight / fromHeight)) : 0;
    return (base === 300 || base === 500 ? 420 : base) + Math.min(680, octaves * 115) + rotation;
  }
  sample(t: number): Pose {
    const q = slerp(this.a, this.b, t), [x, y, z, w] = q;
    const target = { x: mix(this.from.target.x, this.to.target.x, t), y: mix(this.from.target.y, this.to.target.y, t), z: mix(this.from.target.z, this.to.target.z, t) };
    const d = mix(length(sub(this.from.position, this.from.target)), length(sub(this.to.position, this.to.target)), t);
    return { target, position: { x: target.x + 2 * (x * z + w * y) * d,
      y: target.y + 2 * (y * z - w * x) * d, z: target.z + (1 - 2 * (x * x + y * y)) * d },
      up: { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) } };
  }
}
export const testIfcEase = (t: number): number => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
export function waitForCameraAnimation(done: () => boolean): Promise<void> {
  return new Promise(resolve => {
    const check = () => { if (done()) resolve(); else requestAnimationFrame(check); };
    check();
  });
}
