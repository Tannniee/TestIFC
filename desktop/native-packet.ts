/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { MeshData } from '../packages/geometry/src/types';

interface Descriptor {
  expressId: number;
  ifcType: string;
  color: [number, number, number, number];
  origin: [number, number, number];
  geometryClass: number;
  geometryItemId: number | null;
  materialId: number | null;
  localBounds: [number, number, number, number, number, number] | null;
  localToWorld: number[] | null;
  positionsLen: number;
  normalsLen: number;
  indicesLen: number;
  uvsLen: number;
  texture: { texture_id: number; rgba?: number[]; width: number; height: number;
    url?: string; repeat_s: boolean; repeat_t: boolean } | null;
}

/** Packet-local arrays are views of one ArrayBuffer. Every range is validated. */
export function decodeNativePacket(buffer: ArrayBuffer): MeshData[] {
  if (buffer.byteLength < 16) throw new Error('Truncated native IFC packet');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x44434649 || header.getUint32(4, true) !== 1) {
    throw new Error('Unsupported native IFC packet');
  }
  const metadataLength = header.getUint32(8, true);
  const count = header.getUint32(12, true);
  let offset = 16 + Math.ceil(metadataLength / 4) * 4;
  if (offset > buffer.byteLength) throw new Error('Truncated native IFC descriptors');
  const descriptors: Descriptor[] = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, metadataLength)));
  if (!Array.isArray(descriptors) || descriptors.length !== count) throw new Error('Invalid native IFC descriptor count');
  function array<T extends Float32Array | Uint32Array>(length: number, ctor: {
    new(buffer: ArrayBuffer, offset: number, length: number): T;
  }): T {
    if (!Number.isSafeInteger(length) || length < 0 || length > (buffer.byteLength - offset) / 4) {
      throw new Error('Native IFC pool range exceeds packet');
    }
    const view = new ctor(buffer, offset, length);
    offset += length * 4;
    return view;
  }
  const meshes = descriptors.map((d): MeshData => {
    const positions = array(d.positionsLen, Float32Array);
    const normals = array(d.normalsLen, Float32Array);
    const indices = array(d.indicesLen, Uint32Array);
    const uvs = array(d.uvsLen, Float32Array);
    if (positions.length % 3 || indices.length % 3 || (normals.length && normals.length !== positions.length)
        || (uvs.length && uvs.length !== positions.length / 3 * 2)) throw new Error('Invalid native IFC mesh dimensions');
    for (const index of indices) if (index >= positions.length / 3) throw new Error('Invalid native IFC triangle index');
    const mesh: MeshData = { expressId: d.expressId, ifcType: d.ifcType, color: d.color,
      positions, normals, indices, origin: d.origin, geometryClass: d.geometryClass,
      appearanceSource: { kind: 'canonical-item', indices, sourceIndices: indices } };
    if (d.geometryItemId !== null) mesh.geometryItemId = d.geometryItemId;
    if (d.materialId !== null) mesh.materialId = d.materialId;
    if (uvs.length) mesh.uvs = uvs;
    if (d.texture?.rgba) mesh.texture = {
      rgba: Uint8Array.from(d.texture.rgba), width: d.texture.width, height: d.texture.height,
      repeatS: d.texture.repeat_s, repeatT: d.texture.repeat_t };
    else if (d.texture?.url) mesh.textureRef = { textureId: d.texture.texture_id, url: d.texture.url,
      repeatS: d.texture.repeat_s, repeatT: d.texture.repeat_t };
    if (d.localBounds) mesh.localBounds = { min: d.localBounds.slice(0, 3) as [number, number, number],
      max: d.localBounds.slice(3, 6) as [number, number, number] };
    if (d.localToWorld) mesh.localToWorld = d.localToWorld;
    return mesh;
  });
  if (offset !== buffer.byteLength) throw new Error('Unexpected trailing native IFC bytes');
  return meshes;
}
