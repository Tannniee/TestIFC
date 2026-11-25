/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import type { DataModel } from '@ifc-lite/server-client';
import { NativeEntityColumns } from '../../../../desktop/native-entity-columns';
import { convertServerDataModel, convertServerDataModelAsync } from './serverDataModel';

function fixture(count = 20_000): DataModel {
  const entities = new NativeEntityColumns();
  for (let i = 1; i <= count; i++) entities.append({ entity_id: i, type_name: i === 1 ? 'IFCPROJECT' : 'IFCWALL',
    global_id: `wall-${i}`, name: i % 2 ? undefined : `Wall ${i}`, has_geometry: true });
  return { entities: entities.finish(),
    propertySets: new Map([[count + 1, { pset_id: count + 1, pset_name: 'Dimensions', properties: [
      { property_name: 'Width', property_value: '20', property_type: 'real', data_type: 'IFCLENGTHMEASURE' },
    ] }]]), quantitySets: new Map(),
    relationships: Array.from({ length: count }, (_, i) => ({ rel_type: 'IFCRELDEFINESBYPROPERTIES',
      rel_id: count * 2 + i, relating_id: count + 1, related_id: i + 1 })),
    classifications: [], materials: [], documents: [],
    spatialHierarchy: { project_id: 1, nodes: [{ entity_id: 1, parent_id: 0, level: 0,
      path: 'Project', type_name: 'IFCPROJECT', children_ids: [], element_ids: [] }], element_to_storey: new Map(),
      element_to_building: new Map(), element_to_site: new Map(), element_to_space: new Map() },
  };
}
const parse = { cache_key: '', metadata: { schema_version: 'IFC4' }, stats: {
  total_time_ms: 0, parse_time_ms: 0, geometry_time_ms: 0, total_vertices: 0, total_triangles: 0,
} };

it('yields through entity and bidirectional CSR construction with identical BIM answers', async () => {
  const expected = convertServerDataModel(fixture(), parse, { size: 100 }, []);
  let yields = 0;
  const input = fixture();
  const actual = await convertServerDataModelAsync(input, parse, { size: 100 }, [],
    { releaseRelationshipRows: true }, { budgetMs: 0,
      yieldControl: async () => { yields++; await setImmediate(); } });
  assert.ok(yields > 20, `large tables need bounded intermediate turns, got ${yields}`);
  assert.equal(input.relationships.length, 0, 'native-owned wire edges are released');
  for (const key of ['expressId', 'typeEnum', 'globalId', 'name', 'description', 'objectType', 'flags'] as const)
    assert.deepEqual(actual.entities[key], expected.entities[key], key);
  for (const id of [1, 2, 10_000, 20_000]) {
    assert.equal(actual.entities.getNameOrUndefined(id), expected.entities.getNameOrUndefined(id));
    assert.deepEqual(actual.properties.getForEntity(id), expected.properties.getForEntity(id));
    assert.deepEqual(actual.relationships.getRelationshipsBetween(20_001, id),
      expected.relationships.getRelationshipsBetween(20_001, id));
  }
  assert.deepEqual(actual.entityIndex.byType, expected.entityIndex.byType);
  assert.equal(actual.source.byteLength, 0);
});

it('cancels a partially built native BIM snapshot before any completed store escapes', async () => {
  const controller = new AbortController();
  let yielded = 0, published = false;
  await assert.rejects(convertServerDataModelAsync(fixture(), parse, { size: 100 }, [],
    { releaseRelationshipRows: true }, { signal: controller.signal, budgetMs: 0,
      yieldControl: async () => { if (++yielded === 3) controller.abort(); await setImmediate(); } })
    .then(() => { published = true; }), error => error instanceof Error && error.name === 'AbortError');
  assert.equal(published, false);
  assert.equal(yielded, 3);
});
