/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { IfcTypeEnum, type SpatialHierarchy, type SpatialNode } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import { buildTreeData, buildTreeDataSteps } from './treeDataBuilder';
import { runCooperatively } from '@/utils/runCooperatively';
import { act, createElement, useState } from 'react';
import { cleanup, render } from '@/test/render';
import { fixtureModel } from '@/test/store-fixture';
import { useStructuralHierarchy } from './useStructuralHierarchy';
import { buildTreeForGrouping } from './revealGlobalId';
import type { TreeNode } from './types';

function fixture(count: number): IfcDataStore {
  const elements = Array.from({ length: count }, (_, index) => index + 10);
  const storey: SpatialNode = { expressId: 2, type: IfcTypeEnum.IfcBuildingStorey,
    name: 'Level 1', children: [], elements };
  const project: SpatialNode = { expressId: 1, type: IfcTypeEnum.IfcProject,
    name: 'Project', children: [storey], elements: [] };
  const spatialHierarchy: SpatialHierarchy = {
    project, byStorey: new Map([[2, elements]]), byBuilding: new Map(), bySite: new Map(),
    bySpace: new Map(), storeyElevations: new Map(), storeyHeights: new Map(),
    elementToStorey: new Map(elements.map(id => [id, 2])),
    getStoreyElements: () => elements, getStoreyByElevation: () => null,
    getContainingSpace: () => null, getPath: () => [],
  };
  return { spatialHierarchy, entities: {
    getName: (id: number) => `Wall ${id}`, getTypeName: () => 'IfcWall',
  } } as unknown as IfcDataStore;
}

it('cooperative spatial rows equal the synchronous canonical tree and yield during emission', async () => {
  const store = fixture(5000), expansion = { has: () => true };
  const expected = buildTreeData(new Map(), store, expansion, false, [], 'elevation-asc');
  let clock = 0, yields = 0;
  const actual = await runCooperatively(buildTreeDataSteps(new Map(), store, expansion, false, [], 'elevation-asc'), {
    budgetMs: 0, now: () => ++clock, yieldControl: async () => { yields++; await setImmediate(); },
  });
  assert.deepEqual(actual, expected);
  assert.equal(actual.filter(row => row.type === 'element').length, 5000);
  assert.ok(yields >= 10, `large emission must yield repeatedly, saw ${yields}`);
});

it('aborting a spatial tree build rejects instead of returning a partial tree', async () => {
  const controller = new AbortController();
  await assert.rejects(runCooperatively(buildTreeDataSteps(new Map(), fixture(5000),
    { has: () => true }, false, [], 'elevation-asc'), {
    budgetMs: 0, signal: controller.signal,
    yieldControl: async () => { controller.abort(); },
  }), error => error instanceof Error && error.name === 'AbortError');
});

it('native spatial hook discards a stale model build and publishes only completed current rows', async () => {
  type Inputs = Parameters<typeof buildTreeForGrouping>;
  function inputs(count: number, name: string): Inputs {
    const model = fixtureModel(name);
    model.loadPath = 'native';
    model.ifcDataStore = fixture(count);
    model.ifcDataStore.entities.getName = id => `${name} ${id}`;
    return ['spatial', new Map([[name, model]]), null, { has: () => true }, false, [],
      'elevation-asc', new Set(), new Set(), [], 'all', new Set(), new Map(), new Map()];
  }
  const oldInputs = inputs(50_000, 'old'), currentInputs = inputs(20, 'current');
  const host = globalThis as typeof globalThis & {
    scheduler?: { postTask(callback: () => void, options: { priority: 'background' }): Promise<void> };
  };
  const previous = host.scheduler;
  const resumes: Array<() => void> = [];
  host.scheduler = { postTask: () => new Promise(resolve => resumes.push(resolve)), yield: () => Promise.resolve() };
  let rows: TreeNode[] = [], change!: (next: Inputs) => void;
  function Probe() {
    const [value, setValue] = useState(oldInputs);
    change = setValue;
    rows = useStructuralHierarchy(value, true);
    return null;
  }
  try {
    render(createElement(Probe));
    assert.ok(resumes.length > 0, 'large native build paused in a background turn');
    assert.equal(rows.length, 0, 'partial rows remain unpublished');
    await act(async () => { change(currentInputs); await setImmediate(); });
    await act(async () => {
      while (resumes.length) { resumes.splice(0).forEach(resolve => resolve()); await setImmediate(); }
    });
    assert.equal(rows.filter(row => row.type === 'element').length, 20);
    assert.ok(rows.filter(row => row.type === 'element').every(row => row.name.startsWith('current')));
    assert.ok(!rows.some(row => row.modelId === 'old'), 'canceled model never publishes');
  } finally {
    cleanup();
    resumes.splice(0).forEach(resolve => resolve());
    host.scheduler = previous;
  }
});
