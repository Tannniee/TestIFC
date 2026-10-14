/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useViewerStore } from '@/store';
import type { GeometryResult } from '@ifc-lite/geometry';

function geometryKey(geometry: GeometryResult | null | undefined): string {
  return `${geometry?.meshes.length ?? 0}:${JSON.stringify(geometry?.coordinateInfo)}`;
}

/** Metadata updates replace the models Map too; they do not invalidate a gesture. */
export function captureBoxScope() {
  const s = useViewerStore.getState();
  return {
    models: new Map(Array.from(s.models, ([id, model]) => [id, {
      geometry: model.geometryResult, key: geometryKey(model.geometryResult), visible: model.visible,
    }])),
    geometry: s.models.size ? null : s.geometryResult,
    geometryKey: s.models.size ? '' : geometryKey(s.geometryResult),
    placement: s.modelPlacement,
    mutation: s.mutationVersion,
    alignment: s.pointCloudAlignmentEnabled,
  };
}

export function isCurrentBoxScope(scope: ReturnType<typeof captureBoxScope>): boolean {
  const s = useViewerStore.getState();
  if (scope.models.size !== s.models.size || scope.placement !== s.modelPlacement
    || scope.mutation !== s.mutationVersion || scope.alignment !== s.pointCloudAlignmentEnabled) return false;
  if (!s.models.size && (scope.geometry !== s.geometryResult || scope.geometryKey !== geometryKey(s.geometryResult))) return false;
  for (const [id, before] of scope.models) {
    const model = s.models.get(id);
    if (!model || model.geometryResult !== before.geometry || model.visible !== before.visible
      || geometryKey(model.geometryResult) !== before.key) return false;
  }
  return true;
}
