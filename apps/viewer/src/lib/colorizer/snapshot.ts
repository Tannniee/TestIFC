/* SPDX-License-Identifier: MPL-2.0 */
import { useViewerStore } from '@/store';

/** Freeze the exact source and editing revision without hydrating the source-less
 * native display store or launching another geometry load pipeline. */
export function captureColorizerSnapshot(modelId: string) {
  const state = useViewerStore.getState();
  const model = state.models.get(modelId);
  const dataStore = model?.ifcDataStore;
  if (!model || !dataStore) throw new Error('Choose a loaded IFC model');
  if (model.schemaVersion === 'IFC5') throw new Error('Colorizer requires a STEP IFC model');
  // `slice()` is one memcpy into a plain buffer (a Blob refuses shared memory);
  // `Uint8Array.from` iterated byte by byte before the Blob copied it again.
  const source = model.sourceFile && /\.ifc$/i.test(model.sourceFile.name)
    ? model.sourceFile
    : dataStore.source.byteLength ? dataStore.source.withMaterialized(bytes => new Blob([bytes.slice()])) : undefined;
  if (!source) throw new Error('The original IFC source is unavailable. Reload this model from its IFC file.');
  const view = state.mutationViews.get(modelId);
  const transaction = view?.prepareAtomic(() => undefined);
  const georef = state.georefMutations.get(modelId);
  const scheduleData = state.scheduleData;
  const scheduleIsEdited = state.scheduleIsEdited;
  const scheduleSourceModelId = state.scheduleSourceModelId;
  const ownsEditedSchedule = scheduleIsEdited && scheduleSourceModelId === modelId;
  const mutations: Record<string, unknown> = view ? JSON.parse(view.exportMutations()) : { mutations: [] };
  mutations.newEntities = view?.getNewEntities() ?? [];
  if (georef) mutations.georefMutations = georef;
  // Properties, zones, exports and other panels register an empty view the
  // first time they touch a model. An empty journal is the same editing
  // revision as no view, so that registration must not discard the draft.
  const capturedEmpty = !view || (view.getMutationCount() === 0 && view.getNewEntities().length === 0);
  const sameEditingRevision = (latestView: typeof view) => latestView === view || (capturedEmpty && !!latestView
    && latestView.getMutationCount() === 0 && latestView.getNewEntities().length === 0);
  const validate = () => {
    const current = useViewerStore.getState();
    const latest = current.models.get(modelId);
    const ownsCurrentSchedule = current.scheduleIsEdited && current.scheduleSourceModelId === modelId;
    if (latest?.ifcDataStore !== dataStore || latest?.sourceFile !== model.sourceFile
      || !sameEditingRevision(current.mutationViews.get(modelId)) || current.georefMutations.get(modelId) !== georef
      || ownsCurrentSchedule !== ownsEditedSchedule
      || (ownsEditedSchedule && current.scheduleData !== scheduleData)) {
      throw new Error('The model changed. Refresh Colorizer before continuing.');
    }
    transaction?.validate();
  };
  return { modelId, name: model.name, source, mutations: JSON.stringify(mutations), dataStore, validate,
    scheduleState: { scheduleData, scheduleIsEdited, scheduleSourceModelId } };
}
export type ColorizerSnapshot = ReturnType<typeof captureColorizerSnapshot>;
