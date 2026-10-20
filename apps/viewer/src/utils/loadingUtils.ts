/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared loading utilities used across all IFC loading hooks.
 *
 * Builds each model's placed spatial index with stale-load guards.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import { buildSpatialIndexAsync, type MeshWithBounds, type SpatialIndex } from '@ifc-lite/spatial';
import { placedMesh } from '@/lib/model-placement/placed-geometry';
import { displayedTranslation } from '@/lib/model-placement/state';
import { placementSnapshot, placementSnapshotIsCurrent } from '@/lib/model-placement/placement-snapshot';
import { useViewerStore, type ViewerState } from '../store/index.js';
import { hasInstancedShards, instancedShardRevision } from '@/store/instancedShardModels';
import { modelIndices } from '@/lib/model-placement/model-indices';

interface PickIndexSnapshot {
  index: SpatialIndex;
  placement: ReturnType<typeof placementSnapshot>;
  meshes: MeshData[] | undefined;
  content: number;
  instances: number;
  owner: number | undefined;
  offset: number;
  maxId: number;
  completeInstances: boolean;
}
const pickIndexes = new WeakMap<IfcDataStore, PickIndexSnapshot>();

/** A pick must reject stale coordinates even before placement-sync effects run. */
export function currentPickSpatialIndex(state: ViewerState, modelId: string): SpatialIndex | undefined {
  const model = state.models.get(modelId), store = model?.ifcDataStore;
  const entry = store && pickIndexes.get(store);
  return model && store && entry && entry.index === store.spatialIndex
    && entry.meshes === model.geometryResult?.meshes && entry.content === state.geometryContentVersion
    && entry.instances === instancedShardRevision(modelId) && entry.owner === modelIndices(state.models).get(modelId)
    && entry.offset === model.idOffset && entry.maxId === model.maxExpressId
    && (entry.completeInstances || !hasInstancedShards(modelId))
    && placementSnapshotIsCurrent(entry.placement, state) ? entry.index : undefined;
}

/**
 * Build a spatial index for a specific (e.g. federated) model.
 *
 * This guards on the target model still holding the same store and publishes
 * through `updateModel(modelId, ...)`, without touching the active-model slot.
 *
 * @param meshes - Final mesh array with correct IDs and world-space positions
 * @param modelId - The federated model to attach the spatial index to
 * @param dataStore - That model's IfcDataStore (mutated in place)
 */
export function buildSpatialIndexForModel(
  meshes: MeshData[],
  modelId: string,
  dataStore: IfcDataStore,
  coordinates: 'source' | 'placed' = 'source',
  instanceBounds?: Iterable<MeshWithBounds>,
): Promise<boolean> {
  if (meshes.length === 0 && instanceBounds === undefined) return Promise.resolve(true);

  const initial = useViewerStore.getState(), snapshot = placementSnapshot(initial, [modelId], false);
  const initialModel = initial.models.get(modelId);
  if (!initialModel) return Promise.resolve(false);
  const pickSnapshot = { placement: snapshot, meshes: initialModel.geometryResult?.meshes,
    content: initial.geometryContentVersion, instances: instancedShardRevision(modelId),
    owner: modelIndices(initial.models).get(modelId), offset: initialModel.idOffset, maxId: initialModel.maxExpressId,
    completeInstances: instanceBounds !== undefined };
  const generation = nextSpatialIndexGeneration(dataStore);
  const placed = coordinates === 'placed' ? meshes : meshes.map((mesh) => placedMesh(mesh, displayedTranslation(initial.modelPlacement, modelId)));
  return buildSpatialIndexAsync(placed, 4, instanceBounds).then(spatialIndex => {
    const state = useViewerStore.getState();
    const model = state.models.get(modelId);
    // Model removed, or its store was replaced since this build started.
    if (!model || model.ifcDataStore !== dataStore || generations.get(dataStore) !== generation || !placementSnapshotIsCurrent(snapshot, state)) return false;
    dataStore.spatialIndex = spatialIndex;
    pickIndexes.set(dataStore, { ...pickSnapshot, index: spatialIndex });
    state.updateModel(modelId, { ifcDataStore: dataStore });
    return true;
  }).catch(err => {
    console.warn('[loadingUtils] Failed to build spatial index for model:', err);
    return false;
  });
}

const generations = new WeakMap<IfcDataStore, number>();
function nextSpatialIndexGeneration(store: IfcDataStore): number {
  const next = (generations.get(store) ?? 0) + 1; generations.set(store, next); return next;
}

/** Withdraw old coordinates immediately and supersede every outstanding build. */
export function invalidateSpatialIndex(store: IfcDataStore): void {
  nextSpatialIndexGeneration(store);
  pickIndexes.delete(store);
  store.spatialIndex = undefined;
}
