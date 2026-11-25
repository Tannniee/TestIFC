/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { MeshData } from '@ifc-lite/geometry';
import type { BatchedMesh } from './types.js';
import type { ModelTranslations, ModelYaw } from './model-translation.js';
import { destroyGpuResources } from './scene-geometry.js';

/** Geometry arrays are immutable; copy mutable placement/color headers only. */
export function snapshotBatchMeshes(meshes: readonly MeshData[]): MeshData[] {
  return meshes.map(mesh => ({ ...mesh,
    color: [...mesh.color],
    origin: mesh.origin ? [...mesh.origin] : undefined,
  }));
}

/** A whole-model move can occur while CPU preparation yields. Keep the
 * completed batch in the current world frame before registering its baseline. */
export function reconcilePreparedBatch(batch: BatchedMesh, placement: ModelTranslations,
  modelIndex: number, offset: readonly [number, number, number], yaw: ModelYaw | null): void {
  const currentYaw = placement.getYaw(modelIndex);
  if (currentYaw?.angle !== yaw?.angle || currentYaw?.px !== yaw?.px || currentYaw?.pz !== yaw?.pz) {
    destroyGpuResources(batch);
    throw new Error('Model rotation changed while preparing a GPU batch');
  }
  const current = placement.get(modelIndex);
  for (let axis = 0; axis < 3; axis++) {
    const delta = current[axis] - offset[axis];
    if (batch.origin) batch.origin[axis] += delta;
    if (batch.bounds) { batch.bounds.min[axis] += delta; batch.bounds.max[axis] += delta; }
  }
}
