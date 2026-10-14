/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { IfcDataStore } from '@ifc-lite/parser';
import type { FederatedModel } from '@/store';
import { createStoreyDisplayElevationResolver } from '@/lib/geo/storey-elevation';
import type { GeorefMutationDataLike } from '@/lib/geo/effective-georef';

export type StoreyDisplayElevation = (storeyId: number, relativeElevationMeters: number) => number;

/** Resolve badge elevations with the owning model's effective georef edits. */
export function storeyDisplayElevationFor(
  modelId: string,
  dataStore: IfcDataStore,
  model: FederatedModel | undefined,
  georefMutations: ReadonlyMap<string, GeorefMutationDataLike> | undefined,
): StoreyDisplayElevation {
  const mutationKey = modelId === 'legacy' ? '__legacy__' : modelId;
  return createStoreyDisplayElevationResolver(
    dataStore, model?.geometryResult?.coordinateInfo, georefMutations?.get(mutationKey),
  );
}
