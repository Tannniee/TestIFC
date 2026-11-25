/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { GeometryResult, GeometryDiagnostics } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import { flushSync } from 'react-dom';
import { useViewerStore } from '../../store';
import { placementSourceIdentity } from '../../lib/model-placement/source-identity';
import type { NativeIfcRuntime } from './nativeIfcContract';
import { nativeIfcStoreAsync } from './nativeIfcStore';
import { getViewerSchemaVersion } from './viewerModelIngest';
import { modelIndices } from '../../lib/model-placement/model-indices';

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
    diagnostics: GeometryDiagnostics | undefined, instancedShards: ArrayBuffer[]) => Promise<void>;
}

/** A desktop source adapter inside loadFile; registration/alignment remain in
 * its canonical finalizer. No independent primary or federation loader. */
export async function loadNativeIfcModel(options: Options): Promise<void> {
  const { file, modelId, kind, runtime, isCurrent, finalize } = options;
  const controller = new AbortController();
  options.onAbortReady(() => controller.abort());
  const stage = async (phase: string, percent: number) => {
    if (kind === 'primary' && isCurrent()) useViewerStore.getState().setProgress({ phase, percent });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    controller.signal.throwIfAborted();
  };
  const result = await runtime.load(file, { signal: controller.signal,
    onProgress: (phase, percent, indeterminate) => {
      if (kind === 'primary' && isCurrent()) useViewerStore.getState().setProgress({ phase, percent, indeterminate });
    } });
  if (!isCurrent()) return;
  await stage('Building native BIM indexes', 96);
  const { dataStore, geometryResult } = await nativeIfcStoreAsync(result, file, { signal: controller.signal });
  await stage('Identifying native model source', 97);
  const hash = await placementSourceIdentity(file, () => !isCurrent());
  if (!isCurrent()) return;
  const fingerprint = `${file.name}:native:${hash ?? modelId}`;
  await stage('Registering native scene', 98);
  // Native returns a complete CPU snapshot. Let the existing renderer queue
  // upload it in bounded slices instead of one non-streaming React effect.
  const modelIndex = modelIndices(useViewerStore.getState().models).get(modelId) ?? 0;
  // The adapter owns these new meshes. Stamp ownership once so viewport merges
  // can share them rather than cloning every mesh on each registration render.
  for (const mesh of result.meshes) mesh.modelIndex = modelIndex;
  // The first flush below can render the hierarchy before finalizeModel runs.
  // Mark its native origin now so that initial tree also uses background work.
  useViewerStore.getState().updateModel(modelId, { loadPath: 'native' });
  useViewerStore.getState().setGeometryStreamingActive(true);
  if (kind === 'primary') {
    const state = useViewerStore.getState();
    state.updateModel(modelId, { sourceFingerprint: fingerprint, sourceContentHash: hash });
    flushSync(() => {
      state.setIfcDataStore(dataStore);
      state.setGeometryResult(geometryResult);
    });
  }
  await finalize(dataStore, geometryResult, getViewerSchemaVersion(dataStore), { fingerprint, hash }, result.diagnostics, result.instancedShards ?? []);
  if (!isCurrent()) return;
  // Federated registration is asynchronous. Flush its geometry commit while
  // streaming is still true, before signalling the queue's finalization.
  flushSync(() => useViewerStore.getState().setProgress({ phase: 'Uploading native scene', percent: 99 }));
  const state = useViewerStore.getState();
  state.updateModel(modelId, { geometryLoadState: 'complete', metadataLoadState: 'complete', interactiveReady: true });
  // loadFile owns the global loading overlay for primary and added models.
  // Complete it after the shared finalizer has finished alignment as well.
  state.setProgress({ phase: 'Complete', percent: 100 });
  state.setGeometryStreamingActive(false);
  state.setLoading(false);
}
