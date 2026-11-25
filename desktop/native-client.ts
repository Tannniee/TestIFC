/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { ServerEntityIndex, type DataModel, type EntityMetadata,
  type ModelMetadata, type ProcessingStats } from '@ifc-lite/server-client';
import type { NativeIfcRuntime, NativeIfcResult } from '../apps/viewer/src/hooks/ingest/nativeIfcContract';
import type { MeshData, CoordinateInfo, GeometryDiagnostics } from '../packages/geometry/src/index';
import { decodeNativePacket } from './native-packet';

export type NativeInvoke = <T>(command: string, args?: Record<string, unknown> | Uint8Array,
  options?: { headers?: Record<string, string> }) => Promise<T>;

interface Summary {
  metadata: ModelMetadata;
  stats: ProcessingStats & { geometry_diagnostics?: GeometryDiagnostics };
  colorUpdates: [number, [number, number, number, number]][];
  siteTransform?: number[] | null;
  buildingTransform?: number[] | null;
  buildingRotation?: number | null;
}
interface Status { done: boolean; error?: string; summary?: Summary;
  progress?: { processedElements: number; totalElements: number; meshes: number } }
export interface SemanticWire {
  entities: EntityMetadata[];
  propertySets: DataModel['propertySets'] extends Map<number, infer T> ? T[] : never;
  quantitySets: DataModel['quantitySets'] extends Map<number, infer T> ? T[] : never;
  relationships: DataModel['relationships'];
  classifications: DataModel['classifications'];
  materials: DataModel['materials'];
  documents: DataModel['documents'];
  spatialHierarchy: Omit<DataModel['spatialHierarchy'], 'element_to_storey' | 'element_to_building' | 'element_to_site' | 'element_to_space'> & {
    element_to_storey: [number, number][]; element_to_building: [number, number][];
    element_to_site: [number, number][]; element_to_space: [number, number][];
  };
}

export function hydrateNativeSemantics(wire: SemanticWire): DataModel {
  return { entities: ServerEntityIndex.fromRows(wire.entities),
    propertySets: new Map(wire.propertySets.map(p => [p.pset_id, p])),
    quantitySets: new Map(wire.quantitySets.map(q => [q.qset_id, q])),
    relationships: wire.relationships, classifications: wire.classifications,
    materials: wire.materials, documents: wire.documents,
    spatialHierarchy: { ...wire.spatialHierarchy,
      element_to_storey: new Map(wire.spatialHierarchy.element_to_storey),
      element_to_building: new Map(wire.spatialHierarchy.element_to_building),
      element_to_site: new Map(wire.spatialHierarchy.element_to_site),
      element_to_space: new Map(wire.spatialHierarchy.element_to_space) } };
}

export function nativeCoordinates(meshes: MeshData[], summary: Summary): CoordinateInfo {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const mesh of meshes) {
    const o = mesh.origin ?? [0, 0, 0];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] + o[0], y = mesh.positions[i + 1] + o[1], z = mesh.positions[i + 2] + o[2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('Native IFC returned a non-finite vertex');
      min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
    }
  }
  if (!Number.isFinite(min.x)) throw new Error('Native IFC returned no renderable geometry');
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
      const meshes: MeshData[] = [];
      let summary: Summary | undefined;
      let lastStatusAt = -Infinity, lastYieldAt = Date.now();
      while (true) {
        signal.throwIfAborted();
        const packet = await invoke<ArrayBuffer>('native_next_packet', { id });
        if (packet.byteLength) {
          for (const mesh of decodeNativePacket(packet)) meshes.push(mesh);
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
            onProgress(`Native Rust geometry · ${meshes.length.toLocaleString()} meshes`, 20, true);
          }
          if (!packet.byteLength && status.done) {
            // Outcome can become ready while the IPC status call is in flight.
            // Drain the final packet(s) before accepting the completed result.
            const tail = await invoke<ArrayBuffer>('native_next_packet', { id });
            if (tail.byteLength) { for (const mesh of decodeNativePacket(tail)) meshes.push(mesh); continue; }
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
      if (!summary || meshes.length !== summary.stats.total_meshes) throw new Error('Incomplete native IFC stream');
      const colors = new Map(summary.colorUpdates);
      for (const mesh of meshes) { const color = colors.get(mesh.expressId); if (color) mesh.color = color; }
      onProgress('Native BIM properties and hierarchy', 85);
      const wire = await invoke<SemanticWire>('native_data_model', { id, rootedOnly: true });
      signal.throwIfAborted();
      onProgress('Preparing native scene', 95);
      await delay(0);
      return { meshes, dataModel: hydrateNativeSemantics(wire),
        coordinateInfo: nativeCoordinates(meshes, summary), metadata: summary.metadata,
        stats: summary.stats, diagnostics: summary.stats.geometry_diagnostics };
    } finally {
      signal.removeEventListener('abort', abort);
      await close();
    }
  } };
}
