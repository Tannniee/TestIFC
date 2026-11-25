/* SPDX-License-Identifier: MPL-2.0 */
import { create } from 'zustand';
import { useViewerStore } from '@/store';
import { resolveEntityRef } from '@/store/resolveEntityRef';
import { modelCopyExportDenial } from '@/store/mutation-permission';
import type { ColorizerColor } from './types';
import type { FederatedModel } from '@/store/types';

export interface QuickPaint {
  modelId: string;
  source: FederatedModel['ifcDataStore'];
  products: number[];
  color: ColorizerColor;
}
export const useQuickPaint = create<{ requests: QuickPaint[] }>(() => ({ requests: [] }));
export function consumeQuickPaint(request: QuickPaint): void {
  useQuickPaint.setState(s => ({ requests: s.requests.filter(item => item !== request) }));
}

/** Capture the context selection now; opening a panel must not change its scope. */
export function requestQuickPaint(entityId: number, hex: string): void {
  const s = useViewerStore.getState();
  const ref = resolveEntityRef(entityId);
  if (!ref.modelId) throw new Error('No IFC model selected.');
  const model = s.models.get(ref.modelId);
  const denial = modelCopyExportDenial(s, ref.modelId);
  if (denial) throw new Error(denial);
  if (!model || model.schemaVersion === 'IFC5') throw new Error('Choose an IFC2X3 or IFC4 model.');
  const ids = s.selectedEntityIds.has(entityId) ? [...s.selectedEntityIds] : [entityId];
  const products = ids.map(id => resolveEntityRef(id)).filter(item => item.modelId === model.id).map(item => item.expressId);
  const color: ColorizerColor = [Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255, 1];
  useQuickPaint.setState(state => ({ requests: [...state.requests, { modelId: model.id, source: model.ifcDataStore, products, color }] }));
  s.showWorkspacePanel('colorizer', 'context');
}
