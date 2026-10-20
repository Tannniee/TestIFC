/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { CameraViewpoint } from '@/store/types';
import type { CameraOrientation, ViewDirection } from './viewcube-math';
export type CubeView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/** IFC-Lite world axes: +Y top, +Z front, +X right. */
export function namedCubeView(d: ViewDirection): CubeView | null {
  if (Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z) !== 1) return null;
  if (d.x) return d.x > 0 ? 'right' : 'left';
  if (d.y) return d.y > 0 ? 'top' : 'bottom';
  return d.z > 0 ? 'front' : 'back';
}

/** Full pose preserves rolled views and repeated preset rotations. */
export function cubeOrientation(x: number, y: number, pose?: CameraViewpoint | null): CameraOrientation {
  if (!pose) return new Quaternion().setFromEuler(new Euler(x * Math.PI / 180, -y * Math.PI / 180, 0, 'YXZ'));
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(
    new Vector3(pose.position.x, pose.position.y, pose.position.z),
    new Vector3(pose.target.x, pose.target.y, pose.target.z),
    new Vector3(pose.up.x, pose.up.y, pose.up.z),
  )).normalize();
}

/** Edge/corner clicks retain target, distance and projection. */
export function cubeDirectionPose(pose: CameraViewpoint, d: ViewDirection): CameraViewpoint {
  const target = new Vector3(pose.target.x, pose.target.y, pose.target.z);
  const distance = new Vector3(pose.position.x, pose.position.y, pose.position.z).distanceTo(target);
  const position = target.clone().addScaledVector(new Vector3(d.x, d.y, d.z).normalize(), distance);
  return { ...pose, position: { x: position.x, y: position.y, z: position.z }, up: { x: 0, y: 1, z: 0 } };
}
