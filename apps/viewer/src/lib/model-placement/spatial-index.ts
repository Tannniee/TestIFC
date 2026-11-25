/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useViewerStore, type ViewerState } from '@/store';
import { instancedShardRevision } from '@/store/instancedShardModels';
import { invalidateSpatialIndex, buildSpatialIndexForModel } from '@/utils/loadingUtils';
import { getGlobalRenderer } from '@/hooks/useBCF';
import type { MeshWithBounds } from '@ifc-lite/spatial';
import { placedViewGeometry } from './view-geometry';
import { modelIndices } from './model-indices';
import { displayedTranslation } from './state';
import { equalTranslation } from './translation';

/** Index displayed flat geometry and compact instance world boxes. Triangle
 * expansion belongs to explicit export/exact intersection, never automatic BVH
 * construction. Renderer ownership disambiguates overlapping federated IDs. */
export function buildPlacedSpatialIndex(state: ViewerState, modelId: string): Promise<boolean> {
  const model = state.models.get(modelId);
  if (!model?.ifcDataStore || !model.geometryResult) return Promise.resolve(false);
  const geometry = placedViewGeometry(model.geometryResult, state, modelId);
  const scene = getGlobalRenderer()?.getScene();
  const owner = modelIndices(state.models).get(modelId);
  const { idOffset, maxExpressId } = model;
  function* instanceBounds(): IterableIterator<MeshWithBounds> {
    if (!scene || owner === undefined) return;
    for (const expressId of scene.getInstancedEntityIds()) {
      if (expressId <= idOffset || expressId > idOffset + maxExpressId) continue;
      const box = scene.getInstancedEntityBounds(expressId, owner);
      if (box) yield { expressId, bounds: {
        min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z],
      } };
    }
  }
  return buildSpatialIndexForModel(geometry.meshes, modelId, model.ifcDataStore, 'placed', instanceBounds());
}

/** Debounce the CPU query index, never geometry uploads. Generation guards in
 * the canonical builder prevent a late load or older move from publishing it. */
export function createPlacementIndexSync() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  const ready = (state: ViewerState, id: string): boolean => {
    const model = state.models.get(id);
    return !!model?.ifcDataStore && !!model.geometryResult
      && (model.loadState === undefined || model.loadState === 'complete')
      && !state.pendingInstancedShards?.some(shard => shard.modelId === id);
  };
  const signature = (state: ViewerState, id: string) => {
    const model = state.models.get(id)!;
    return { store: model.ifcDataStore!, meshes: model.geometryResult!.meshes,
      content: state.geometryContentVersion, instances: instancedShardRevision(id),
      offset: model.idOffset, maxId: model.maxExpressId,
      rendererIndex: modelIndices(state.models).get(id),
      translation: displayedTranslation(state.modelPlacement, id),
      frame: state.modelPlacement.realignedFrameKey };
  };
  const indexed = new Map<string, ReturnType<typeof signature>>();
  const same = (a: ReturnType<typeof signature> | undefined, b: ReturnType<typeof signature>) =>
    !!a && a.store === b.store && a.meshes === b.meshes && a.content === b.content
    && a.instances === b.instances && a.offset === b.offset && a.maxId === b.maxId
    && a.rendererIndex === b.rendererIndex && a.frame === b.frame
    && equalTranslation(a.translation, b.translation);
  const schedule = (reset = false) => {
    if (!pending.size) return;
    if (timer) {
      if (!reset) return;
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      const latest = useViewerStore.getState();
      pending.clear(); timer = undefined;
      for (const [id] of latest.models) {
        if (!ready(latest, id)) continue;
        const next = signature(latest, id);
        if (same(indexed.get(id), next)) continue;
        indexed.set(id, next);
        void Promise.resolve().then(() => buildPlacedSpatialIndex(latest, id)).then(published => {
          // Keep the in-flight signature to avoid repeated builds on ordinary
          // store updates. A failed/stale build must be retryable on refresh.
          if (!published && indexed.get(id) === next) indexed.delete(id);
        }).catch(err => {
          if (indexed.get(id) === next) indexed.delete(id);
          console.warn('[spatial-index] Failed to start placed index build:', err);
        });
      }
    }, 200);
  };
  const refresh = (state: ViewerState, reset = false) => {
    for (const [id, model] of state.models) {
      if (!ready(state, id)) continue;
      const next = signature(state, id);
      if (!same(indexed.get(id), next)) {
        if (!pending.has(id) && (indexed.has(id) || model.ifcDataStore!.spatialIndex)) invalidateSpatialIndex(model.ifcDataStore!);
        pending.add(id);
      }
    }
    schedule(reset);
  };
  return {
    refreshMissing(state: ViewerState) { refresh(state); },
    update(state: ViewerState, previous: ViewerState) {
      let moved = false;
      if (state.pendingInstancedShards !== previous.pendingInstancedShards && state.pendingInstancedShards) {
        const oldLength = previous.pendingInstancedShards?.length ?? 0;
        for (const { modelId } of state.pendingInstancedShards.slice(oldLength)) {
          const store = state.models.get(modelId)?.ifcDataStore;
          if (store) invalidateSpatialIndex(store);
        }
      }
      for (const [id, model] of state.models) {
        if (!model.ifcDataStore) continue;
        if (state.modelPlacement.realignedFrameKey !== previous.modelPlacement.realignedFrameKey || !equalTranslation(
          displayedTranslation(state.modelPlacement, id), displayedTranslation(previous.modelPlacement, id))) {
          invalidateSpatialIndex(model.ifcDataStore);
          indexed.delete(id);
          moved = true;
        } else if (state.geometryContentVersion !== previous.geometryContentVersion) {
          invalidateSpatialIndex(model.ifcDataStore);
        }
      }
      for (const id of indexed.keys()) if (!state.models.has(id)) indexed.delete(id);
      refresh(state, moved);
    },
    dispose() { if (timer) clearTimeout(timer); timer = undefined; pending.clear(); },
  };
}
