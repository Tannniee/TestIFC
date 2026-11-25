/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { CameraViewpoint, SectionBox, SectionBoxFace } from '@/store/types';
import { MIN_SECTION_BOX_SIZE_M, faceSide, type Vec3Tuple } from './section-box';

export const IFC_BOX_AXES = [
  { label: 'X', axis: 0, sign: 1 },
  { label: 'Y', axis: 2, sign: -1 },
  { label: 'Z', axis: 1, sign: 1 },
] as const;

export function ifcBoxValue(box: SectionBox, index: number, side: 'min' | 'max'): number {
  const { axis, sign } = IFC_BOX_AXES[index];
  const corner = sign > 0 ? side : side === 'min' ? 'max' : 'min';
  return box[corner][axis] * sign || 0;
}

export function editIfcBoxValue(box: SectionBox, index: number, side: 'min' | 'max', value: number): SectionBox | null {
  const { axis, sign } = IFC_BOX_AXES[index];
  const corner = sign > 0 ? side : side === 'min' ? 'max' : 'min';
  const next: SectionBox = { min: [...box.min], max: [...box.max] };
  next[corner][axis] = value * sign;
  return [...next.min, ...next.max].every(Number.isFinite)
    && next.min.every((v, i) => next.max[i] - v >= MIN_SECTION_BOX_SIZE_M) ? next : null;
}

/** Four corners also cover a rolled / building-aligned Top view. */
export function boxFromSweep(corners: Array<{ x: number; y: number; z: number } | null>, model: SectionBox): SectionBox | null {
  if (corners.length !== 4 || corners.some(p => !p || ![p.x, p.y, p.z].every(Number.isFinite))) return null;
  const points = corners.filter(p => p !== null);
  const padding = Math.max((model.max[1] - model.min[1]) * .00001, .001);
  const min: Vec3Tuple = [Math.min(...points.map(p => p.x)), model.min[1] - padding, Math.min(...points.map(p => p.z))];
  const max: Vec3Tuple = [Math.max(...points.map(p => p.x)), model.max[1] + padding, Math.max(...points.map(p => p.z))];
  if (min.some((v, i) => max[i] - v < MIN_SECTION_BOX_SIZE_M)) return null;
  if ([0, 2].some(i => max[i] <= model.min[i] || min[i] >= model.max[i])) return null;
  return { min, max };
}

export function visibleHeight(pose: CameraViewpoint | null | undefined): number {
  if (!pose) return 1;
  if (pose.projectionMode === 'orthographic') return Math.max(.001, (pose.orthoSize ?? 1) * 2);
  const distance = Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z);
  return Math.max(.001, 2 * distance * Math.tan(pose.fov * Math.PI / 360));
}

/** Positive world-axis motion; edge-on axes use TestIFC's vertical fallback. */
export function boxDragAxis(face: SectionBoxFace, foot: { x: number; y: number }, tip: { x: number; y: number }, span: number, height: number) {
  const sign = faceSide(face).corner === 'max' ? 1 : -1;
  const dx = (tip.x - foot.x) * sign, dy = (tip.y - foot.y) * sign;
  const length = Math.hypot(dx, dy);
  return length * span > 2
    ? { x: dx / length, y: dy / length, metersPerPixel: 1 / length }
    : { x: 0, y: -1, metersPerPixel: span / Math.max(1, height) };
}
