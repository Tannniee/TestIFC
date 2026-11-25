/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { CoordinateInfo, MeshData, GeometryDiagnostics } from '@ifc-lite/geometry';
import type { DataModel, ModelMetadata, ProcessingStats } from '@ifc-lite/server-client';

export interface NativeIfcResult {
  meshes: MeshData[];
  coordinateInfo: CoordinateInfo;
  dataModel: DataModel;
  metadata: ModelMetadata;
  stats: ProcessingStats;
  diagnostics?: GeometryDiagnostics;
}

export interface NativeIfcRuntime {
  load(file: File, options: {
    signal: AbortSignal;
    onProgress: (phase: string, percent: number, indeterminate?: boolean) => void;
  }): Promise<NativeIfcResult>;
}

export function nativeIfcRuntime(): NativeIfcRuntime | undefined {
  return (globalThis as typeof globalThis & { __IFCLITE_NATIVE__?: NativeIfcRuntime }).__IFCLITE_NATIVE__;
}
