/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { GeometryResult, GeometryDiagnostics } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '../../store';
import { placementSourceIdentity } from '../../lib/model-placement/source-identity';
import type { NativeIfcRuntime } from './nativeIfcContract';
import { nativeIfcStore } from './nativeIfcStore';
import { getViewerSchemaVersion } from './viewerModelIngest';

interface Options {
  file: File;
  modelId: string;
  kind: 'primary' | 'federated';
  runtime: NativeIfcRuntime;
  isCurrent: () => boolean;
  onAbortReady: (abort: () => void) => void;
  finalize: (store: IfcDataStore, geometry: GeometryResult,
    schema: ReturnType<typeof getViewerSchemaVersion>,
    identity: { fingerprint: string; hash: string | undefined },
    diagnostics: GeometryDiagnostics | undefined) => Promise<void>;
}

/** A desktop source adapter inside loadFile; registration/alignment remain in
 * its canonical finalizer. No independent primary or federation loader. */
export async function loadNativeIfcModel(options: Options): Promise<void> {
  const { file, modelId, kind, runtime, isCurrent, finalize } = options;
  const controller = new AbortController();
  options.onAbortReady(() => controller.abort());
  const result = await runtime.load(file, { signal: controller.signal,
    onProgress: (phase, percent, indeterminate) => {
      if (kind === 'primary' && isCurrent()) useViewerStore.getState().setProgress({ phase, percent, indeterminate });
    } });
  if (!isCurrent()) return;
  const { dataStore, geometryResult } = nativeIfcStore(result, file);
  const hash = await placementSourceIdentity(file, () => !isCurrent());
  if (!isCurrent()) return;
  const fingerprint = `${file.name}:native:${hash ?? modelId}`;
  if (kind === 'primary') {
    const state = useViewerStore.getState();
    state.updateModel(modelId, { sourceFingerprint: fingerprint, sourceContentHash: hash });
    state.setIfcDataStore(dataStore);
    state.setGeometryResult(geometryResult);
  }
  await finalize(dataStore, geometryResult, getViewerSchemaVersion(dataStore), { fingerprint, hash }, result.diagnostics);
  if (!isCurrent()) return;
  const state = useViewerStore.getState();
  state.updateModel(modelId, { geometryLoadState: 'complete', metadataLoadState: 'complete', interactiveReady: true });
  // loadFile owns the global loading overlay for primary and added models.
  // Complete it after the shared finalizer has finished alignment as well.
  state.setProgress({ phase: 'Complete', percent: 100 });
  state.setGeometryStreamingActive(false);
  state.setLoading(false);
}
