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
  const source = model.sourceFile && /\.ifc$/i.test(model.sourceFile.name)
    ? model.sourceFile
    : dataStore.source.byteLength ? dataStore.source.withMaterialized(bytes => new Blob([Uint8Array.from(bytes)])) : undefined;
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
  const validate = () => {
    const current = useViewerStore.getState();
    const latest = current.models.get(modelId);
    const ownsCurrentSchedule = current.scheduleIsEdited && current.scheduleSourceModelId === modelId;
    if (latest?.ifcDataStore !== dataStore || latest?.sourceFile !== model.sourceFile
      || current.mutationViews.get(modelId) !== view || current.georefMutations.get(modelId) !== georef
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
