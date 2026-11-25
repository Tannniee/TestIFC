/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateNativeSemantics } from '../../../../../desktop/native-client';
import { decodeNativePacket } from '../../../../../desktop/native-packet';
import { nativeIfcStore } from './nativeIfcStore';

test('native BIM tables resolve Properties/Qto and spatial containment without source bytes', () => {
  const dataModel = hydrateNativeSemantics({
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
      { rel_type: 'IFCRELDEFINESBYPROPERTIES', relating_id: 10, related_id: 3 },
      { rel_type: 'IFCRELDEFINESBYPROPERTIES', relating_id: 11, related_id: 3 },
      { rel_type: 'IFCRELCONTAINEDINSPATIALSTRUCTURE', relating_id: 2, related_id: 3 },
    ], classifications: [], materials: [], documents: [],
    spatialHierarchy: { project_id: 1, nodes: [
      { entity_id: 1, parent_id: 0, level: 0, path: 'Project', type_name: 'IFCPROJECT', children_ids: [2], element_ids: [] },
      { entity_id: 2, parent_id: 1, level: 1, path: 'Project/L1', type_name: 'IFCBUILDINGSTOREY', children_ids: [], element_ids: [3] },
    ], element_to_storey: [[3, 2]], element_to_building: [], element_to_site: [], element_to_space: [] },
  });
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
  assert.equal(dataStore.lengthUnitScale, .001);
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
