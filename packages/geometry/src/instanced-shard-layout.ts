/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Shared IFNS structural validation. Reading census/color lanes must not
 * materialize an object and a copied transform for every occurrence. */
export function instancedShardLayout(buffer: ArrayBuffer) {
  if (buffer.byteLength < 32) throw new Error('Instanced shard too small for header');
  const header = new Uint32Array(buffer, 0, 8);
  const [magic, version, templateCount, instanceCount, positionsLen, normalsLen, indicesLen] = header;
  if (magic !== 0x4946_4e53) throw new Error('Invalid instanced shard magic');
  if (version === 0) throw new Error(`Unsupported instanced shard version: ${version}`);
  // v1 reserves word 7; v2+ declares an append-only stride. Zero means base.
  const stride = version >= 2 && header[7] !== 0 ? header[7] : 88;
  if (stride < 88) throw new Error(`Instanced shard instance stride ${stride} is below the 88-byte base record`);
  if (stride % 4 !== 0) throw new Error(`Instanced shard instance stride ${stride} is not a multiple of 4`);
  const instanceOffset = 32 + templateCount * 48;
  const positionsOffset = instanceOffset + instanceCount * stride;
  const normalsOffset = positionsOffset + positionsLen * 4;
  const indicesOffset = normalsOffset + normalsLen * 4;
  const expectedBytes = indicesOffset + indicesLen * 4;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(`Instanced shard truncated: have ${buffer.byteLength}, need ${expectedBytes}`);
  }
  const view = new DataView(buffer);
  for (let t = 0; t < templateCount; t++) {
    const base = 32 + t * 48;
    if (view.getUint32(base, true) + view.getUint32(base + 4, true) > positionsLen
        || view.getUint32(base + 8, true) + view.getUint32(base + 12, true) > normalsLen
        || view.getUint32(base + 16, true) + view.getUint32(base + 20, true) > indicesLen) {
      throw new Error(`Instanced shard template ${t} pool offset out of bounds`);
    }
  }
  for (let i = 0; i < instanceCount; i++) {
    const template = view.getUint32(instanceOffset + i * stride, true);
    if (template >= templateCount) {
      throw new Error(`Instanced shard instance ${i} references missing template ${template} (have ${templateCount})`);
    }
  }
  return { view, templateCount, instanceCount, stride, instanceOffset,
    positionsOffset, positionsLen, normalsOffset, normalsLen, indicesOffset, indicesLen };
}
