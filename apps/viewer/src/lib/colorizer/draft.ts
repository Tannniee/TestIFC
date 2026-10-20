/* SPDX-License-Identifier: MPL-2.0 */
import type { ColorizerBatch, ColorizerColor } from './types';
export type ColorizerPaint = ReadonlyMap<number, ColorizerColor>;
export interface ColorizerHistory { past: ColorizerPaint[]; present: ColorizerPaint; future: ColorizerPaint[] }
export const emptyColorizerHistory = (): ColorizerHistory => ({ past: [], present: new Map(), future: [] });
export function paintColorizer(history: ColorizerHistory, batches: readonly ColorizerBatch[]): ColorizerHistory {
  const next = new Map(history.present);
  for (const batch of batches) {
    if (batch.color.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Invalid colour channel');
    for (const id of batch.products) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid IFC express id');
      next.set(id, batch.color);
    }
  }
  return { past: [...history.past, history.present].slice(-30), present: next, future: [] };
}
export function restoreColorizer(history: ColorizerHistory): ColorizerHistory {
  return { past: [...history.past, history.present].slice(-30), present: new Map(), future: [] };
}
export function undoColorizer(history: ColorizerHistory): ColorizerHistory {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
}
export function redoColorizer(history: ColorizerHistory): ColorizerHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}
/** Flatten the final draft before writing: every product belongs to one batch. */
export function colorizerBatches(paint: ColorizerPaint): ColorizerBatch[] {
  const batches = new Map<string, ColorizerBatch>();
  for (const [id, color] of paint) {
    const key = color.join(',');
    let batch = batches.get(key);
    if (!batch) { batch = { products: [], color }; batches.set(key, batch); }
    batch.products.push(id);
  }
  return [...batches.values()];
}
