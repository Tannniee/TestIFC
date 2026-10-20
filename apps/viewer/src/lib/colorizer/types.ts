/* SPDX-License-Identifier: MPL-2.0 */
export type ColorizerColor = readonly [number, number, number, number];
export type ColorizerMode = 'section' | 'class' | 'material' | 'storey' | 'property';
export interface ColorizerGrouping { mode: ColorizerMode; property: string }
export interface ColorizerGroup { name: string; source: string; products: number[] }
export interface ColorizerCatalog { schema: string; productIds: number[]; groups: ColorizerGroup[] }
export interface ColorizerBatch { products: number[]; color: ColorizerColor }
export interface ColorizerSession {
  catalog(grouping: ColorizerGrouping): Promise<ColorizerCatalog>;
  export(batches: ColorizerBatch[], onProgress?: (done: number, total: number) => void): Promise<Blob>;
  close(): Promise<void>;
}
export interface ColorizerRuntime {
  open(source: Blob, mutations: string, options: { signal: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<ColorizerSession>;
}
export function colorizerRuntime(): ColorizerRuntime | undefined {
  return (globalThis as typeof globalThis & { __IFCLITE_COLORIZER__?: ColorizerRuntime }).__IFCLITE_COLORIZER__;
}
