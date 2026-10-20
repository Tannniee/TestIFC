/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { GeometryResult } from '@ifc-lite/geometry';

/** Retained GPU instance templates must keep their owner index after another
 * model is removed. Never compact indices in a live federation. */
export function createModelIndexAllocator() {
  let next = 0;
  const assigned = new Map<string, number>();
  return (models: ReadonlyMap<string, unknown>): Map<string, number> => {
    if (!models.size) { assigned.clear(); next = 0; }
    for (const id of assigned.keys()) if (!models.has(id)) assigned.delete(id);
    for (const id of models.keys()) if (!assigned.has(id)) assigned.set(id, next++);
    return new Map(assigned);
  };
}
export const modelIndices = createModelIndexAllocator();

export function geometryWithModelIndex(geometry: GeometryResult | null, index: number): GeometryResult | null {
  if (!geometry) return null;
  const stampMeshes = geometry.meshes.some(mesh => mesh.modelIndex !== index);
  const stampPoints = geometry.pointClouds?.some(asset => asset.modelIndex !== index) ?? false;
  if (!stampMeshes && !stampPoints) return geometry;
  return { ...geometry,
    meshes: stampMeshes ? geometry.meshes.map(mesh => mesh.modelIndex === index ? mesh : { ...mesh, modelIndex: index }) : geometry.meshes,
    pointClouds: stampPoints ? geometry.pointClouds?.map(asset => asset.modelIndex === index ? asset : { ...asset, modelIndex: index }) : geometry.pointClouds };
}

