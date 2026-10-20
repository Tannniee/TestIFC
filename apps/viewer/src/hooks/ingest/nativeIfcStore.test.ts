/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNativeSemantics } from '../../../../../desktop/native-semantics';
import type { NativeInvoke } from '../../../../../desktop/native-client';
import { decodeNativePacket } from '../../../../../desktop/native-packet';
import { nativeIfcStore } from './nativeIfcStore';
import { extractProjectUnits, type EntityIndex, type EntityRef, type ResolvedUnit } from '@ifc-lite/parser';
import type { NativeIfcResult } from './nativeIfcContract';

type NativeUnitSnapshot = { byType: Record<string, ResolvedUnit | null>; monetary: ResolvedUnit | null };

function unitSource() {
  const text = [
    "#1=IFCPROJECT('project-mm',$,'Project mm',$,$,$,$,$,#10);",
    "#2=IFCPROJECT('project-m',$,'Project m',$,$,$,$,$,#20);",
    '#10=IFCUNITASSIGNMENT((#11,#12,#13,#14));',
    '#11=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);',
    '#12=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);',
    "#13=IFCMONETARYUNIT('USD');",
    "#14=IFCCONVERSIONBASEDUNIT($,.MASSUNIT.,'Unresolved mass',#999);",
    '#20=IFCUNITASSIGNMENT((#21,#22));',
    '#21=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
    '#22=IFCSIUNIT(*,.AREAUNIT.,.MILLI.,.SQUARE_METRE.);',
  ].join('\n') + '\n';
  const byId = new Map<number, EntityRef>(), byType = new Map<string, number[]>();
  let offset = 0, lineNumber = 0;
  for (const line of text.split('\n')) {
    lineNumber++;
    const match = /^#(\d+)=([A-Z0-9_]+)\(/.exec(line);
    if (match) {
      const expressId = Number(match[1]), type = match[2];
      byId.set(expressId, { expressId, type, byteOffset: offset, byteLength: line.length, lineNumber });
      const ids = byType.get(type) ?? []; ids.push(expressId); byType.set(type, ids);
    }
    offset += line.length + 1;
  }
  return { source: new TextEncoder().encode(text), entityIndex: { byId, byType } satisfies EntityIndex };
}

async function nativeUnitStore() {
  const records = [
    ['entityScope', 'entities-rooted'],
    ['entities', { entity_id: 1, type_name: 'IFCPROJECT', name: 'Project mm', has_geometry: false }],
    ['entities', { entity_id: 2, type_name: 'IFCPROJECT', name: 'Project m', has_geometry: false }],
    ['spatialNodes', { entity_id: 1, parent_id: 0, level: 0, path: 'Project mm', type_name: 'IFCPROJECT', children_ids: [], element_ids: [] }],
    ['spatialNodes', { entity_id: 2, parent_id: 0, level: 0, path: 'Project m', type_name: 'IFCPROJECT', children_ids: [], element_ids: [] }],
    ['projectId', 1], ['complete', true],
  ];
  const bytes = new TextEncoder().encode(records.map(row => JSON.stringify(row)).join('\n') + '\n');
  let sent = false;
  const invoke: NativeInvoke = async <T>(command: string): Promise<T> => {
    if (command === 'native_prepare_semantics') return bytes.length as T;
    const packet = sent ? new ArrayBuffer(0) : bytes.slice().buffer; sent = true;
    return packet as T;
  };
  const dataModel = await readNativeSemantics(invoke, 'unit-job', new AbortController().signal, () => {});
  const result: NativeIfcResult & { projectUnits: Map<number, NativeUnitSnapshot> } = {
    dataModel, meshes: [],
    projectUnits: new Map<number, NativeUnitSnapshot>([
      [1, { byType: { LENGTHUNIT: { symbol: 'mm', siScale: .001 }, AREAUNIT: { symbol: 'm²', siScale: 1 },
        MASSUNIT: null }, monetary: { symbol: '$', siScale: 1 } }],
      [2, { byType: { LENGTHUNIT: { symbol: 'm', siScale: 1 }, AREAUNIT: { symbol: 'mm²', siScale: .000001 } },
        monetary: null }],
    ]),
    coordinateInfo: { originShift: { x: 0, y: 0, z: 0 },
      originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, hasLargeCoordinates: false },
    metadata: { schema_version: 'IFC4', entity_count: 2, geometry_entity_count: 0,
      coordinate_info: { origin_shift: [0, 0, 0], is_geo_referenced: false }, length_unit_scale: .001 },
    stats: { total_meshes: 0, total_vertices: 0, total_triangles: 0, parse_time_ms: 0,
      geometry_time_ms: 0, total_time_ms: 0, from_cache: false },
  };
  return nativeIfcStore(result, { size: bytes.length } as File).dataStore;
}

test('source-less native units retain millimetres, independent area units and currency', async () => {
  const native = await nativeUnitStore(), oracle = unitSource();
  assert.equal(native.source.byteLength, 0, 'native BIM retains no whole IFC source');
  const nativeUnits = extractProjectUnits(native.source, native.entityIndex);
  const sourceUnits = extractProjectUnits(oracle.source, oracle.entityIndex);
  for (const measure of ['IfcPositiveLengthMeasure', 'IfcAreaMeasure', 'IfcMonetaryMeasure']) {
    assert.deepEqual(nativeUnits.unitForMeasure(measure), sourceUnits.unitForMeasure(measure), measure);
  }
  assert.equal(nativeUnits.unitForMeasure('IfcPositiveLengthMeasure')?.symbol, 'mm');
  assert.equal(nativeUnits.unitForMeasure('IfcAreaMeasure')?.siScale, 1,
    'area must come from its own declaration rather than squaring the length scale');
});

test('source-less native units preserve an unresolved declaration without inventing an SI label', async () => {
  const native = await nativeUnitStore(), oracle = unitSource();
  const sourceUnits = extractProjectUnits(oracle.source, oracle.entityIndex);
  assert.equal(sourceUnits.unitForMeasure('IfcMassMeasure'), null, 'fixture has a declared but unresolved mass unit');
  const nativeUnits = extractProjectUnits(native.source, native.entityIndex);
  assert.equal(nativeUnits.unitForMeasure('IfcMassMeasure'), null);
  assert.equal(nativeUnits.declaredCount, sourceUnits.declaredCount);
});

test('source-less native units resolve the requested project independently', async () => {
  const native = await nativeUnitStore(), oracle = unitSource();
  for (const projectId of [1, 2]) {
    const nativeUnits = extractProjectUnits(native.source, native.entityIndex, projectId);
    const sourceUnits = extractProjectUnits(oracle.source, oracle.entityIndex, projectId);
    for (const measure of ['IfcLengthMeasure', 'IfcAreaMeasure', 'IfcMonetaryMeasure']) {
      assert.deepEqual(nativeUnits.unitForMeasure(measure), sourceUnits.unitForMeasure(measure), `${projectId}: ${measure}`);
    }
  }
  assert.equal(extractProjectUnits(native.source, native.entityIndex, 2).unitForMeasure('IfcAreaMeasure')?.symbol, 'mm²');
  assert.equal(extractProjectUnits(native.source, native.entityIndex, 999).declaredCount, 0);
});

test('native BIM tables resolve Properties/Qto and spatial containment without source bytes', async () => {
  const wire = {
    entities: [
      { entity_id: 1, type_name: 'IFCPROJECT', global_id: 'project', name: 'Project', has_geometry: false },
      { entity_id: 2, type_name: 'IFCBUILDINGSTOREY', name: 'L1', has_geometry: false },
      { entity_id: 3, type_name: 'IFCWALL', name: 'Wall A', global_id: 'wall-a', has_geometry: true },
    ],
    propertySets: [{ pset_id: 10, pset_name: 'Pset_WallCommon', properties: [
      { property_name: 'IsExternal', property_value: 'true', property_type: 'boolean' },
    ] }],
    quantitySets: [{ qset_id: 11, qset_name: 'Qto_WallBaseQuantities', quantities: [
      { quantity_name: 'Length', quantity_value: 3.2, quantity_type: 'length' },
    ] }],
    relationships: [
      { rel_type: 'IFCRELDEFINESBYPROPERTIES', relating_id: 10, related_id: 3, rel_id: 40 },
      { rel_type: 'IFCRELDEFINESBYPROPERTIES', relating_id: 10, related_id: 3, rel_id: 41 },
      { rel_type: 'IFCRELDEFINESBYPROPERTIES', relating_id: 11, related_id: 3 },
      { rel_type: 'IFCRELCONTAINEDINSPATIALSTRUCTURE', relating_id: 2, related_id: 3 },
    ], classifications: [], materials: [], documents: [],
    spatialHierarchy: { project_id: 1, nodes: [
      { entity_id: 1, parent_id: 0, level: 0, path: 'Project', type_name: 'IFCPROJECT', children_ids: [2], element_ids: [] },
      { entity_id: 2, parent_id: 1, level: 1, path: 'Project/L1', type_name: 'IFCBUILDINGSTOREY', children_ids: [], element_ids: [3] },
    ], element_to_storey: [[3, 2]], element_to_building: [], element_to_site: [], element_to_space: [] },
  };
  const records: unknown[] = [['entityScope', 'entities-rooted']];
  for (const table of ['entities', 'propertySets', 'quantitySets', 'relationships', 'classifications', 'materials', 'documents'] as const) {
    for (const row of wire[table]) records.push([table, row]);
  }
  records.push(['projectId', wire.spatialHierarchy.project_id]);
  for (const row of wire.spatialHierarchy.nodes) records.push(['spatialNodes', row]);
  for (const row of wire.spatialHierarchy.element_to_storey) records.push(['elementToStorey', row]);
  records.push(['complete', true]);
  const bytes = new TextEncoder().encode(records.map(row => JSON.stringify(row)).join('\n') + '\n');
  let sent = false;
  const invoke: NativeInvoke = async <T>(command: string): Promise<T> => {
    if (command === 'native_prepare_semantics') return bytes.length as T;
    const result = sent ? new ArrayBuffer(0) : bytes.slice().buffer; sent = true;
    return result as T;
  };
  const dataModel = await readNativeSemantics(invoke, 'job', new AbortController().signal, () => {});
  const { dataStore } = nativeIfcStore({ dataModel, meshes: [],
    coordinateInfo: { originShift: { x: 0, y: 0, z: 0 }, originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, hasLargeCoordinates: false },
    metadata: { schema_version: 'IFC4', entity_count: 3, geometry_entity_count: 1,
      coordinate_info: { origin_shift: [0, 0, 0], is_geo_referenced: false }, length_unit_scale: .001 },
    stats: { total_meshes: 0, total_vertices: 0, total_triangles: 0, parse_time_ms: 0, geometry_time_ms: 0, total_time_ms: 0, from_cache: false },
  }, { size: 123 } as File);
  assert.equal(dataStore.source.byteLength, 0);
  assert.equal(dataStore.properties.getPropertyValue(3, 'Pset_WallCommon', 'IsExternal'), true);
  assert.equal(dataStore.quantities.getQuantityValue(3, 'Qto_WallBaseQuantities', 'Length'), 3.2);
  assert.equal(dataStore.spatialHierarchy?.elementToStorey.get(3), 2);
  assert.equal(dataStore.entities.getName(3), 'Wall A');
  assert.deepEqual(dataStore.entityIndex.byType.get('IFCWALL'), [3], 'the canonical iterator uses uppercase exact-class buckets');
  assert.equal(dataStore.lengthUnitScale, .001);
  assert.equal(dataModel.relationships.length, 0, 'owned wire rows are released after graph ingestion');
  const edge = dataStore.relationships.forward.getEdges(10).find(edge => edge.target === 3);
  assert.equal(edge?.relationshipId, 40);
  assert.deepEqual(edge?.shadowedRelationshipIds, [41], 'releasing wire rows must preserve duplicate relationship identities');
});

test('native binary decoder rejects truncated and unknown protocol packets', () => {
  assert.throws(() => decodeNativePacket(new ArrayBuffer(4)), /Truncated/);
  assert.throws(() => decodeNativePacket(new ArrayBuffer(16)), /Unsupported/);
  const buffer = new ArrayBuffer(16);
  const header = new DataView(buffer);
  header.setUint32(0, 0x44434649, true); header.setUint32(4, 1, true);
  header.setUint32(8, 100, true);
  assert.throws(() => decodeNativePacket(buffer), /Truncated/);
});
