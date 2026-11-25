/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import { fixtureModel, fixtureModels } from '@/test/store-fixture';
import { useViewerStore, type FederatedModel } from '@/store';
import { emptyPlacementState } from './state';
import { buildSpatialIndexForModel, invalidateSpatialIndex } from '@/utils/loadingUtils';
import { placedPickCandidates } from './pick-candidates';
import { noteInstancedShardModel } from '@/store/instancedShardModels';
import { MutablePropertyView } from '@ifc-lite/mutations';

const origin = { x: 0, y: 0, z: 0 }, direction = { x: 0, y: 0, z: -1 };
function model(id: string, expressId: number): FederatedModel {
  const m = fixtureModel(id);
  m.maxExpressId = expressId;
  const mesh: MeshData = { expressId, positions: new Float32Array([-1,-1,-4,1,-1,-4,0,1,-4]),
    normals: new Float32Array(9), indices: new Uint32Array([0,1,2]), color: [1,1,1,1] };
  const bounds = { min: { x: -1, y: -1, z: -4 }, max: { x: 1, y: 1, z: -4 } };
  m.geometryResult = { meshes: [mesh], totalVertices: 3, totalTriangles: 1,
    coordinateInfo: { hasLargeCoordinates: false, originShift: { x: 0, y: 0, z: 0 }, originalBounds: bounds, shiftedBounds: bounds } };
  return m;
}
function seed(...models: FederatedModel[]) {
  useViewerStore.setState({ ...fixtureModels(...models), modelPlacement: emptyPlacementState(),
    mutationViews: new Map(), pendingInstancedShards: [], geometryContentVersion: 0 });
}
async function index(m: FederatedModel) {
  assert.equal(await buildSpatialIndexForModel(m.geometryResult!.meshes, m.id, m.ifcDataStore!, 'placed'), true);
}

it('uses current placed BVHs for one and N models, and distinguishes empty from unavailable (desktop FPS)', async () => {
  const a=model('a',11); seed(a); await index(a);
  assert.deepEqual([...placedPickCandidates(origin,direction)!],[11]);
  assert.equal(placedPickCandidates({x:100,y:0,z:0},direction)?.size,0);
  const b=model('b',2000011);seed(a,b);
  assert.equal(placedPickCandidates(origin,direction),undefined,'a partial federation index must never drop the unindexed model');
  await index(a);await index(b);
  assert.deepEqual(new Set(placedPickCandidates(origin,direction)),new Set([11,2000011]));
  invalidateSpatialIndex(a.ifcDataStore!);
  assert.equal(placedPickCandidates(origin,direction),undefined);
});

it('rejects indexes immediately after geometry, ownership, placement or shard changes (desktop FPS)', async () => {
  const a=model('a',11);seed(a);await index(a);
  useViewerStore.setState({geometryContentVersion:1});
  assert.equal(placedPickCandidates(origin,direction),undefined);
  await index(a);
  const s=useViewerStore.getState();s.openReposition(['a']);s.previewModelTranslation([20,0,0]);s.applyModelTranslation();
  assert.equal(placedPickCandidates(origin,direction),undefined,'do not wait for the placement sync debounce');
  seed(a);await index(a);
  const b=model('b',21);useViewerStore.setState(fixtureModels(b,a));
  await index(b);
  assert.deepEqual(new Set(placedPickCandidates(origin,direction)),new Set([11,21]),'reordering keeps stable renderer owners');
  useViewerStore.getState().updateModel(a.id,{idOffset:1000});
  assert.equal(placedPickCandidates(origin,direction),undefined,'ID-space changes must withdraw the old index');
});

it('requires complete instance bounds and withdraws candidates as soon as another shard arrives (desktop FPS)', async () => {
  const a=model('candidate-instances',11);seed(a);noteInstancedShardModel(a.id);
  await index(a);
  assert.equal(placedPickCandidates(origin,direction),undefined,'a flat-only BVH is incomplete for this model');
  await buildSpatialIndexForModel(a.geometryResult!.meshes,a.id,a.ifcDataStore!,'placed',[
    {expressId:22,bounds:{min:[-1,-1,-8],max:[1,1,-8]}},
  ]);
  assert.deepEqual(new Set(placedPickCandidates(origin,direction)),new Set([11,22]));
  useViewerStore.setState({pendingInstancedShards:[{modelId:a.id,bytes:new ArrayBuffer(1)}]});
  assert.equal(placedPickCandidates(origin,direction),undefined);
  useViewerStore.setState({pendingInstancedShards:[]});noteInstancedShardModel(a.id);
  assert.equal(placedPickCandidates(origin,direction),undefined,'revision changed before any index-sync effect ran');
});

it('uses the BVH with the empty overlay created by the native UI, then falls back after editing (desktop FPS)', async () => {
  const a=model('native-empty-overlay',11);seed(a);await index(a);
  const view=new MutablePropertyView(null,a.id);
  useViewerStore.getState().registerMutationView(a.id,view);
  assert.deepEqual(new Set(placedPickCandidates(origin,direction)),new Set([11]));
  view.setAttribute(11,'Name','Edited');
  assert.equal(placedPickCandidates(origin,direction),undefined,'pending edits must retain exhaustive picking');
});
