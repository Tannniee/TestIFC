/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { ModelMetadata, ProcessingStats } from '@ifc-lite/server-client';
import type { NativeIfcRuntime, NativeIfcResult } from '../apps/viewer/src/hooks/ingest/nativeIfcContract';
import type { CoordinateInfo, GeometryDiagnostics } from '../packages/geometry/src/index';
import { NativeGeometryStream } from './native-geometry-stream';
import { readNativeSemantics } from './native-semantics';

export type NativeInvoke = <T>(command: string, args?: Record<string, unknown> | Uint8Array,
  options?: { headers?: Record<string, string> }) => Promise<T>;

interface Summary {
  metadata: ModelMetadata;
  stats: ProcessingStats & { geometry_diagnostics?: GeometryDiagnostics };
  colorUpdates: [number, [number, number, number, number]][];
  siteTransform?: number[] | null;
  buildingTransform?: number[] | null;
  buildingRotation?: number | null;
  viewerBounds: [number, number, number, number, number, number];
  flatMeshes?: number;
  instancedOccurrences?: number;
  instancedTemplates?: number;
}
interface Status { done: boolean; error?: string; summary?: Summary;
  progress?: { processedElements: number; totalElements: number; meshes: number } }
export function nativeCoordinates(summary: Summary): CoordinateInfo {
  const b = summary.viewerBounds;
  if (!b || b.length !== 6 || !b.every(Number.isFinite)
      || b[0] > b[3] || b[1] > b[4] || b[2] > b[5]) throw new Error('Native IFC returned invalid viewer bounds');
  const min = { x: b[0], y: b[1], z: b[2] }, max = { x: b[3], y: b[4], z: b[5] };
  const [x, y, z] = summary.metadata.coordinate_info.origin_shift;
  // Engine RTC is IFC Z-up. Meshes are already Y-up and shifted: never rebase
  // them in JS. Consumers use the existing RTC metadata contract for overlays.
  const shift = { x, y: z, z: -y };
  return { originShift: { x: 0, y: 0, z: 0 }, shiftedBounds: { min, max },
    originalBounds: { min: { x: min.x + shift.x, y: min.y + shift.y, z: min.z + shift.z },
      max: { x: max.x + shift.x, y: max.y + shift.y, z: max.z + shift.z } },
    hasLargeCoordinates: false, lengthUnitScale: summary.metadata.length_unit_scale ?? 1,
    buildingRotation: summary.buildingRotation ?? undefined,
    wasmRtcFrame: { x, y, z, needsShift: x !== 0 || y !== 0 || z !== 0 },
    ...((x !== 0 || y !== 0 || z !== 0) ? { wasmRtcOffset: { x, y, z } } : {}) };
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createNativeIfcRuntime(invoke: NativeInvoke): NativeIfcRuntime {
  return { async load(file, { signal, onProgress }): Promise<NativeIfcResult> {
    const info = await invoke<{ pointerBits: number; packetVersion: number }>('native_backend_info');
    if (info.pointerBits !== 64 || info.packetVersion !== 1) throw new Error('Unsupported native IFC backend');
    signal.throwIfAborted();
    const id = await invoke<string>('native_create_job');
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await invoke('native_close_job', { id });
    };
    const abort = () => { void close().catch(error => console.error('[Native IFC] cancel failed:', error)); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      for (let offset = 0; offset < file.size; offset += 2 * 1024 * 1024) {
        signal.throwIfAborted();
        const chunk = new Uint8Array(await file.slice(offset, offset + 2 * 1024 * 1024).arrayBuffer());
        await invoke('native_append_source', chunk, { headers: { 'x-ifc-job': id } });
        onProgress('Reading IFC in native backend', Math.round(Math.min(15, (offset + chunk.length) / file.size * 15)));
      }
      signal.throwIfAborted();
      await invoke('native_start_job', { id });
      onProgress('Native Rust indexing', 15, true);
      const geometry = new NativeGeometryStream();
      let summary: Summary | undefined;
      let lastStatusAt = -Infinity, lastYieldAt = Date.now();
      while (true) {
        signal.throwIfAborted();
        const packet = await invoke<ArrayBuffer>('native_next_packet', { id });
        if (packet.byteLength) {
          geometry.accept(packet);
        }
        if (!packet.byteLength || Date.now() - lastStatusAt >= 250) {
          const status = await invoke<Status>('native_job_status', { id });
          lastStatusAt = Date.now();
          if (status.error) throw new Error(status.error);
          const progress = status.progress;
          if (progress && progress.totalElements > 0) {
            const ratio = Math.min(1, progress.processedElements / progress.totalElements);
            onProgress(`Native Rust geometry · ${progress.processedElements.toLocaleString()} / ${progress.totalElements.toLocaleString()} elements`, 20 + 60 * ratio);
          } else {
            // Older hosts cannot report a denominator. Show received mesh counts
            // and an indeterminate bar instead of inventing a capped percentage.
            onProgress(`Native Rust geometry · ${(geometry.meshes.length + geometry.occurrences).toLocaleString()} meshes`, 20, true);
          }
          if (!packet.byteLength && status.done) {
            // Outcome can become ready while the IPC status call is in flight.
            // Drain the final packet(s) before accepting the completed result.
            const tail = await invoke<ArrayBuffer>('native_next_packet', { id });
            if (tail.byteLength) { geometry.accept(tail); continue; }
            summary = status.summary;
            break;
          }
        }
        // Drain ready packets under Rust's two-packet backpressure. A fixed
        // 16ms delay per packet adds almost three minutes for 10,508 packets.
        if (!packet.byteLength) await delay(4);
        else if (Date.now() - lastYieldAt >= 16) {
          await delay(0); // yield to painting/cancel without throttling every pull
          lastYieldAt = Date.now();
        }
      }
      if (!summary) throw new Error('Incomplete native IFC stream');
      const colors = new Map(summary.colorUpdates);
      geometry.finish(summary.stats.total_meshes, summary, summary.metadata.coordinate_info.origin_shift, colors);
      colors.clear();
      summary.colorUpdates.length = 0;
      onProgress('Native BIM properties and hierarchy', 85);
      const dataModel = await readNativeSemantics(invoke, id, signal, (received, total) =>
        onProgress('Receiving native BIM properties and hierarchy', 85 + 9 * received / total));
      signal.throwIfAborted();
      onProgress('Preparing native scene', 95);
      await delay(0);
      return { meshes: geometry.meshes, instancedShards: geometry.shards, instancedGeometryAabbs: geometry.aabbs, dataModel,
        projectUnits: dataModel.projectUnits,
        coordinateInfo: nativeCoordinates(summary), metadata: summary.metadata,
        stats: summary.stats, diagnostics: summary.stats.geometry_diagnostics };
    } finally {
      signal.removeEventListener('abort', abort);
      await close();
    }
  } };
}
