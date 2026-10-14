/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { ServerEntityIndex, type EntityMetadata } from '@ifc-lite/server-client';

/** Keep columns during streaming, rather than all metadata row objects plus a
 * second column copy at completion. Optional strings retain null/empty meaning. */
export class NativeEntityColumns {
  private ids: number[] = [];
  private flags: number[] = [];
  private typeName: (string | null)[] = [];
  private globalId: (string | null)[] = [];
  private name: (string | null)[] = [];
  private description: (string | null)[] = [];
  private objectType: (string | null)[] = [];
  private tag: (string | null)[] = [];
  private predefinedType: (string | null)[] = [];
  private types = new Map<string, string>();

  append(row: EntityMetadata) {
    this.ids.push(row.entity_id);
    this.flags.push(row.has_geometry ? 1 : 0);
    // JSON decoding otherwise creates a fresh repeated class string per row.
    let type = this.types.get(row.type_name);
    if (type === undefined) { type = row.type_name; this.types.set(type, type); }
    this.typeName.push(type);
    this.globalId.push(row.global_id ?? null);
    this.name.push(row.name ?? null);
    this.description.push(row.description ?? null);
    this.objectType.push(row.object_type ?? null);
    this.tag.push(row.tag ?? null);
    this.predefinedType.push(row.predefined_type ?? null);
  }

  finish(): ServerEntityIndex {
    return new ServerEntityIndex({ count: this.ids.length,
      expressId: Uint32Array.from(this.ids), hasGeometry: Uint8Array.from(this.flags),
      typeName: this.typeName, globalId: this.globalId, name: this.name,
      description: this.description, objectType: this.objectType,
      tag: this.tag, predefinedType: this.predefinedType });
  }
}
