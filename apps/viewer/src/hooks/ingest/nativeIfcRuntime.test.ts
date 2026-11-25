/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createNativeIfcRuntime, type NativeInvoke, type SemanticWire } from '../../../../../desktop/native-client';

function packet(id = 1): ArrayBuffer {
  const descriptor = { expressId: id, ifcType: 'IfcWall', color: [1, 1, 1, 1], origin: [0, 0, 0],
    geometryClass: 0, geometryItemId: null, materialId: null, localBounds: null, localToWorld: null,
    positionsLen: 9, normalsLen: 0, indicesLen: 3, uvsLen: 0, texture: null };
  const json = new TextEncoder().encode(JSON.stringify([descriptor]));
  const pool = 16 + ((json.length + 3) & ~3);
  const result = new ArrayBuffer(pool + 48), header = new DataView(result);
  [0x44434649, 1, json.length, 1].forEach((value, index) => header.setUint32(index * 4, value, true));
  new Uint8Array(result, 16, json.length).set(json);
  new Float32Array(result, pool, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint32Array(result, pool + 36, 3).set([0, 1, 2]);
  return result;
}

const semantic: SemanticWire = {
  entities: [], propertySets: [], quantitySets: [], classifications: [], materials: [], documents: [],
  relationships: [],
  spatialHierarchy: { project_id: 0, nodes: [],
    element_to_storey: [], element_to_building: [], element_to_site: [], element_to_space: [] },
};

function backend(count: number, expected = count, tail = false) {
  let pulled = 0, closed = 0, rooted: unknown;
  const summary = {
    metadata: { coordinate_info: { origin_shift: [0, 0, 0] }, schema_version: 'IFC4', entity_count: count, geometry_entity_count: count },
    stats: { total_meshes: expected }, colorUpdates: [],
  };
  const invoke: NativeInvoke = async <T>(command: string, args?: Record<string, unknown> | Uint8Array): Promise<T> => {
    let result: unknown;
    switch (command) {
      case 'native_backend_info': result = { pointerBits: 64, packetVersion: 1 }; break;
      case 'native_create_job': result = 'job'; break;
      case 'native_next_packet':
        // An empty read immediately before a final packet mimics outcome/IPC races.
        if (tail && pulled === count - 1) { tail = false; result = new ArrayBuffer(0); }
        else result = pulled < count ? packet(++pulled) : new ArrayBuffer(0);
        break;
      case 'native_job_status': result = { done: true, summary,
        progress: { processedElements: count, totalElements: count, meshes: count } }; break;
      case 'native_data_model': rooted = args instanceof Uint8Array ? undefined : args?.rootedOnly; result = semantic; break;
      case 'native_close_job': closed++; break;
    }
    return result as T;
  };
  return { invoke, pulled: () => pulled, closed: () => closed, rooted: () => rooted };
}

test('ready native packets drain without a fixed timer delay per packet; BIM request is rooted', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1000 });
  const host = backend(80), abort = new AbortController();
  const load = createNativeIfcRuntime(host.invoke).load(new File(['IFC'], 'model.ifc'), {
    signal: abort.signal, onProgress: () => {},
  });
  // Observe the protocol without advancing a browser timer. The old pump stalls
  // at its first packet's unconditional 16ms timer, even with a ready producer.
  try {
    for (let i = 0; i < 700; i++) await Promise.resolve();
    assert.equal(host.pulled(), 80);
    const result = await load;
    assert.equal(result.meshes.length, 80);
    assert.equal(host.rooted(), true, 'BIM rows, including referenced non-rooted endpoints, are sufficient');
    assert.equal(host.closed(), 1);
  } finally {
    abort.abort();
    await load.catch(() => undefined);
    mock.timers.reset();
  }
});

test('completed status cannot discard an in-flight tail packet', async () => {
  const host = backend(2, 2, true), progress: number[] = [];
  const result = await createNativeIfcRuntime(host.invoke).load(new File(['IFC'], 'model.ifc'), {
    signal: new AbortController().signal, onProgress: (_phase, percent) => progress.push(percent),
  });
  assert.equal(result.meshes.length, 2);
  assert.ok(progress.includes(80), 'real processed-element progress reaches the geometry boundary');
  assert.equal(host.closed(), 1);
});

test('a truncated native stream fails and closes its job instead of accepting partial geometry', async () => {
  const host = backend(1, 2);
  await assert.rejects(createNativeIfcRuntime(host.invoke).load(new File(['IFC'], 'model.ifc'), {
    signal: new AbortController().signal, onProgress: () => {},
  }), /Incomplete native IFC stream/);
  assert.equal(host.closed(), 1);
});
