/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { inspectInstancedShard, updateInstancedShardColors, type MeshData, type EntityWorldAabb } from '@ifc-lite/geometry';
import { decodeNativePacket } from './native-packet';

/** Multiplex flat IFCD, canonical IFNS and exact producer-computed IFCB boxes.
 * Buffers remain owned here until registration; no expanded occurrence meshes. */
export class NativeGeometryStream {
  readonly meshes: MeshData[] = [];
  readonly shards: ArrayBuffer[] = [];
  readonly aabbs = new Map<number, EntityWorldAabb>();
  occurrences = 0;
  templates = 0;
  private boxes = 0;
  private readonly instanceIds = new Set<number>();

  accept(packet: ArrayBuffer): void {
    if (packet.byteLength < 4) throw new Error('Truncated native geometry packet');
    const view = new DataView(packet), magic = view.getUint32(0, true);
    if (magic === 0x44434649) {
      for (const mesh of decodeNativePacket(packet)) this.meshes.push(mesh);
    } else if (magic === 0x49464e53) {
      const shard = inspectInstancedShard(packet, id => this.instanceIds.add(id));
      this.occurrences += shard.instanceCount;
      this.templates += shard.templateCount;
      this.shards.push(packet);
    } else if (magic === 0x42434649) {
      if (packet.byteLength < 12 || view.getUint32(4, true) !== 1) throw new Error('Invalid native bounds packet');
      const count = view.getUint32(8, true);
      if (packet.byteLength !== 12 + count * 52) throw new Error('Truncated native bounds packet');
      for (let i = 0; i < count; i++) {
        const offset = 12 + i * 52, id = view.getUint32(offset, true);
        const b = Array.from({ length: 6 }, (_, k) => view.getFloat64(offset + 4 + k * 8, true));
        if (!id || !b.every(Number.isFinite) || b.some((v, k) => k < 3 && v > b[k + 3])) throw new Error('Invalid native entity bounds');
        const previous = this.aabbs.get(id);
        if (previous) {
          for (let k = 0; k < 3; k++) { previous.min[k] = Math.min(previous.min[k], b[k]); previous.max[k] = Math.max(previous.max[k], b[k + 3]); }
        } else this.aabbs.set(id, { min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] });
      }
      this.boxes += count;
    } else throw new Error('Unknown native geometry packet');
  }

  finish(total: number, counts: { flatMeshes?: number; instancedOccurrences?: number; instancedTemplates?: number },
    rtc: readonly number[], colors: ReadonlyMap<number, [number, number, number, number]>): void {
    if (this.meshes.length + this.occurrences !== total || this.boxes !== this.occurrences
        || this.instanceIds.size !== this.aabbs.size || [...this.aabbs.keys()].some(id => !this.instanceIds.has(id))
        || (counts.flatMeshes !== undefined && counts.flatMeshes !== this.meshes.length)
        || (counts.instancedOccurrences !== undefined && counts.instancedOccurrences !== this.occurrences)
        || (counts.instancedTemplates !== undefined && counts.instancedTemplates !== this.templates)) {
      throw new Error('Incomplete native IFC stream');
    }
    this.instanceIds.clear();
    for (const mesh of this.meshes) { const color = colors.get(mesh.expressId); if (color) mesh.color = color; }
    if (colors.size) for (const shard of this.shards) updateInstancedShardColors(shard, colors);
    // GeometryResult boxes are ABSOLUTE renderer Y-up; packets were post-RTC.
    const shift = [rtc[0], rtc[2], -rtc[1]];
    for (const box of this.aabbs.values()) for (let k = 0; k < 3; k++) { box.min[k] += shift[k]; box.max[k] += shift[k]; }
  }
}
