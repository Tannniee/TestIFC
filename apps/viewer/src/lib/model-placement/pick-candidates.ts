/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Vec3 } from '@ifc-lite/renderer';
import { useViewerStore } from '@/store';
import { currentPickSpatialIndex } from '@/utils/loadingUtils';

/** Reuse the canonical placed indexes, whose IDs already match the scene.
 * A partial/mutating federation must use the exact exhaustive path, never
 * treat an unindexed model or overlay as empty. No triangle expansion here. */
export function placedPickCandidates(origin: Vec3, direction: Vec3): ReadonlySet<number> | undefined {
  const state = useViewerStore.getState();
  if (state.models.size === 0 || state.pendingInstancedShards?.length) return undefined;
  for (const view of state.mutationViews.values()) if (view.hasPendingChanges()) return undefined;
  const indexes = [];
  for (const [id, model] of state.models) {
    if (!model.geometryResult || (model.loadState !== undefined && model.loadState !== 'complete')) return undefined;
    const index = currentPickSpatialIndex(state, id);
    if (!index) return undefined;
    indexes.push(index);
  }
  const candidates = new Set<number>();
  for (const index of indexes) for (const id of index.raycast(
    [origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z],
  )) candidates.add(id);
  return candidates;
}
