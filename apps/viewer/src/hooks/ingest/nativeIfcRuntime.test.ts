/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createNativeIfcRuntime, type NativeInvoke } from '../../../../../desktop/native-client';
import { NativeEntityColumns } from '../../../../../desktop/native-entity-columns';
import { readNativeSemantics } from '../../../../../desktop/native-semantics';
import { decodeNativePacket } from '../../../../../desktop/native-packet';
import { ServerEntityIndex } from '@ifc-lite/server-client';
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useViewerStore } from '../../store';
import { loadNativeIfcModel } from './nativeIfcLoad';
import type { NativeIfcResult } from './nativeIfcContract';
import { geometryWithModelIndex } from '../../lib/model-placement/model-indices';
import { fixtureModel } from '@/test/store-fixture';

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

test('semantic records survive byte boundaries inside UTF-8, with no monolithic response', async () => {
  const entity = { entity_id: 7, type_name: 'IfcWall', global_id: 'Wall', name: 'Mô hình 🌏', has_geometry: true };
  const bytes = new TextEncoder().encode(JSON.stringify(['entities', entity]) + '\n'
    + '["projectUnits",[42,{"byType":{"LENGTHUNIT":{"symbol":"mm","siScale":0.001},"MASSUNIT":null},"monetary":null}]]\n'
    + '["projectId",42]\n["elementToStorey",[7,8]]\n["complete",true]\n');
  let offset = 0;
  const invoke: NativeInvoke = async <T>(command: string): Promise<T> => {
    const result = command === 'native_prepare_semantics' ? bytes.length
      : bytes.slice(offset, ++offset).buffer;
    return result as T;
  };
  const result = await readNativeSemantics(invoke, 'job', new AbortController().signal, () => {});
  assert.equal(result.entities.size, 1);
  assert.equal(result.entities.get(7)?.name, entity.name);
  assert.equal(result.spatialHierarchy.project_id, 42);
  assert.deepEqual([...result.spatialHierarchy.element_to_storey], [[7, 8]]);
  assert.equal(result.propertySets.size, 0);
  assert.deepEqual(result.projectUnits?.get(42), { byType: {
    LENGTHUNIT: { symbol: 'mm', siScale: 0.001 }, MASSUNIT: null }, monetary: null });
});

test('streamed entity columns preserve optional fields and out-of-order identity lookup', () => {
  const columns = new NativeEntityColumns();
  columns.append({ entity_id: 20, type_name: 'IfcWall', has_geometry: true, name: '',
    global_id: 'wall', tag: 'T1', predefined_type: 'SOLIDWALL', description: 'Description', object_type: 'Custom' });
  columns.append({ entity_id: 3, type_name: 'IfcWall', has_geometry: false });
  const index = columns.finish();
  assert.deepEqual([...index.keys()], [20, 3]);
  assert.deepEqual(index.columns.name, ['', null]);
  assert.equal(index.get(3)?.has_geometry, false);
  assert.equal(index.get(20)?.tag, 'T1');
  assert.equal(index.get(20)?.predefined_type, 'SOLIDWALL');
  assert.equal(index.get(20)?.description, 'Description');
  assert.equal(index.get(20)?.object_type, 'Custom');
  assert.equal(index.get(20)?.global_id, 'wall');
});

test('semantic EOF without the completion marker rejects the partial BIM payload', async () => {
  const bytes = new TextEncoder().encode('["projectId",1]\n');
  let sent = false;
  const invoke: NativeInvoke = async <T>(command: string): Promise<T> => {
    let result: unknown;
    if (command === 'native_prepare_semantics') result = bytes.length;
    else { result = sent ? new ArrayBuffer(0) : bytes.slice().buffer; sent = true; }
    return result as T;
  };
  await assert.rejects(readNativeSemantics(invoke, 'job', new AbortController().signal, () => {}), /Incomplete/);
});

function backend(count: number, expected = count, tail = false) {
  let pulled = 0, closed = 0, rooted: unknown;
  let sentSemantics = false;
  const semanticBytes = new TextEncoder().encode('["entityScope","entities-rooted"]\n["complete",true]\n');
  const summary = {
    metadata: { coordinate_info: { origin_shift: [0, 0, 0] }, schema_version: 'IFC4', entity_count: count, geometry_entity_count: count },
    stats: { total_meshes: expected }, colorUpdates: [], viewerBounds: [0, 0, 0, 1, 1, 0],
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
      case 'native_prepare_semantics': rooted = args instanceof Uint8Array ? undefined : args?.rootedOnly; result = semanticBytes.length; break;
      case 'native_next_semantic_packet': result = sentSemantics ? new ArrayBuffer(0) : semanticBytes.slice().buffer; sentSemantics = true; break;
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

for (const kind of ['primary', 'federated'] as const) {
  test(`native ${kind} geometry reaches a React effect in queued upload mode before completion`, async () => {
    const observed: boolean[] = [];
    const observedPaths: Array<string | undefined> = [];
    function UploadObserver() {
      const geometry = useViewerStore(state => state.geometryResult);
      const streaming = useViewerStore(state => state.geometryStreamingActive);
      const path = useViewerStore(state => state.models.get('queue-probe')?.loadPath);
      useEffect(() => { if (geometry?.meshes.length) { observed.push(streaming); observedPaths.push(path); } }, [geometry, streaming, path]);
      return null;
    }
    const result: NativeIfcResult = {
      meshes: decodeNativePacket(packet(2)),
      dataModel: { entities: ServerEntityIndex.fromRows([
        { entity_id: 1, type_name: 'IfcProject', has_geometry: false },
        { entity_id: 2, type_name: 'IfcWall', has_geometry: true },
      ]), propertySets: new Map(), quantitySets: new Map(), relationships: [],
      classifications: [], materials: [], documents: [], spatialHierarchy: {
        project_id: 1, nodes: [{ entity_id: 1, parent_id: 0, level: 0, path: 'Project',
          type_name: 'IfcProject', children_ids: [], element_ids: [2] }],
        element_to_storey: new Map(), element_to_building: new Map(), element_to_site: new Map(), element_to_space: new Map(),
      } },
      coordinateInfo: { originShift: { x: 0, y: 0, z: 0 }, hasLargeCoordinates: false,
        shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
        originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } } },
      metadata: { schema_version: 'IFC4', entity_count: 2, geometry_entity_count: 1,
        coordinate_info: { origin_shift: [0, 0, 0], is_geo_referenced: false } },
      stats: { total_meshes: 1, total_vertices: 3, total_triangles: 1,
        parse_time_ms: 0, geometry_time_ms: 0, total_time_ms: 0, from_cache: false },
    };
    const saved = useViewerStore.getState();
    useViewerStore.setState({ geometryResult: null, geometryStreamingActive: false, loading: true,
      models: new Map([['queue-probe', { ...fixtureModel('queue-probe'), loadPath: undefined }]]) });
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      root.render(createElement(UploadObserver));
      await new Promise(resolve => setTimeout(resolve, 20));
      await loadNativeIfcModel({ file: new File(['IFC'], 'native.ifc'), modelId: 'queue-probe', kind,
        runtime: { load: async () => result }, isCurrent: () => true, onAbortReady: () => {},
        finalize: async (_store, geometry) => {
          if (kind === 'federated') useViewerStore.getState().setGeometryResult(geometry);
        },
      });
      assert.equal(observed[0], true, 'the first geometry commit must queue, not upload the entire snapshot synchronously');
      assert.equal(observedPaths[0], 'native', 'the first complete snapshot must already choose cooperative native hierarchy preparation');
      assert.equal(useViewerStore.getState().geometryStreamingActive, false);
      assert.equal(useViewerStore.getState().loading, false);
    } finally {
      root.unmount();
      useViewerStore.setState(saved, true);
    }
  });
}

test('correctly owned geometry shares mesh objects; a changed owner uses copy-on-write', () => {
  const meshes = decodeNativePacket(packet(2));
  meshes[0].modelIndex = 4;
  const zero = { x: 0, y: 0, z: 0 };
  const source = { meshes, totalVertices: 3, totalTriangles: 1,
    coordinateInfo: { originShift: zero, hasLargeCoordinates: false,
      originalBounds: { min: zero, max: zero }, shiftedBounds: { min: zero, max: zero } } };
  assert.equal(geometryWithModelIndex(source, 4), source);
  const restamped = geometryWithModelIndex(source, 5)!;
  assert.notEqual(restamped.meshes[0], meshes[0]);
  assert.equal(restamped.meshes[0].modelIndex, 5);
  assert.equal(meshes[0].modelIndex, 4, 'another model must not change source ownership');
  assert.equal(restamped.meshes[0].positions, meshes[0].positions);
});
