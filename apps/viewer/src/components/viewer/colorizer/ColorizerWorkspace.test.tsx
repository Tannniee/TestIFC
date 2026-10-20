/* SPDX-License-Identifier: MPL-2.0 */
import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { act, useState } from 'react';
import { render, click, cleanup, waitFor } from '@/test/render';
import { fixtureModel } from '@/test/store-fixture';
import { useViewerStore } from '@/store';
import { ColorizerPanel } from './ColorizerPanel';
import { ColorizerWorkspace } from './ColorizerWorkspace';
import type { ColorizerRuntime, ColorizerBatch } from '@/lib/colorizer/types';

const initial = useViewerStore.getState();
const host = globalThis as typeof globalThis & { __IFCLITE_COLORIZER__?: ColorizerRuntime };
const previous = host.__IFCLITE_COLORIZER__;
afterEach(() => { cleanup(); host.__IFCLITE_COLORIZER__ = previous; useViewerStore.setState(initial); });
function seed() {
  const model = { ...fixtureModel('a', { entities: [{ expressId: 1, type: 'IfcBeam', name: 'Beam' }] }),
    maxExpressId: 100, schemaVersion: 'IFC4' as const, sourceFile: new File(['ISO-10303-21;'], 'a.ifc') };
  useViewerStore.setState({ models: new Map([['a', model]]), activeModelId: 'a', loading: false,
    mutationViews: new Map(), georefMutations: new Map(), overlayLayers: new Map(), collabRole: null });
  return model;
}
function button(ui: HTMLElement, name: string) {
  const found = [...ui.querySelectorAll('button')].find(b => b.textContent === name);
  assert.ok(found, name); return found;
}
function SessionHarness() {
  const [shown, setShown] = useState(true);
  return <ColorizerWorkspace><button onClick={() => setShown(value => !value)}>Switch panel</button>{shown && <ColorizerPanel />}</ColorizerWorkspace>;
}
function runtime() {
  let opens = 0, closes = 0;
  const exported: ColorizerBatch[][] = [];
  host.__IFCLITE_COLORIZER__ = { async open() { opens++; return {
    catalog: async () => ({ schema: 'IFC4', productIds: [1], groups: [{ name: 'Beam', source: 'profile', products: [1] }] }),
    export: async batches => { exported.push(batches); return new Blob(['ISO-10303-21;']); },
    close: async () => { closes++; },
  }; } };
  return { opens: () => opens, closes: () => closes, exported };
}
const paint = () => useViewerStore.getState().overlayLayers.get('colorizer-preview')?.colorOverrides;
async function ready(ui: HTMLElement) {
  await waitFor(() => !button(ui, 'Paint whole model gray').disabled, 'catalog prepared');
}

// Audit regression: tab and split hosts remount their panel body while the file stays open.
it('retains unsaved paint, undo and the source job across a panel-body remount', async t => {
  seed(); const service = runtime(); const ui = render(<SessionHarness />); await ready(ui);
  t.mock.method(URL, 'createObjectURL', () => 'blob:colorizer-lifetime');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  click(button(ui, 'Paint whole model gray')); const layer = paint(); assert.ok(layer?.has(1));
  click(button(ui, 'Switch panel'));
  assert.equal(paint(), layer, 'hiding the panel must not remove authored preview');
  assert.equal(service.closes(), 0, 'a tab switch must not cancel the source job');
  click(button(ui, 'Switch panel')); await ready(ui);
  assert.equal(paint(), layer); assert.equal(button(ui, 'Undo').disabled, false);
  click(button(ui, 'Undo')); assert.equal(paint(), undefined);
  click(button(ui, 'Redo')); assert.deepEqual(paint()?.get(1), [128 / 255, 128 / 255, 128 / 255, 1]);
  assert.equal(service.opens(), 1, 'remount does not upload the same IFC again');
  click(button(ui, 'Save as'));
  await waitFor(() => service.exported.length === 1, 'the restored draft exports');
  assert.deepEqual(service.exported[0], [{ products: [1], color: [128 / 255, 128 / 255, 128 / 255, 1] }]);
  await waitFor(() => !button(ui, 'Save as').disabled, 'download completes');
  cleanup(); assert.equal(paint(), undefined); assert.equal(service.closes(), 1, 'viewer teardown closes exactly its job');
});

it('retains prepared paint when another federated load changes the loading flag', async () => {
  seed(); runtime(); const ui = render(<SessionHarness />); await ready(ui);
  click(button(ui, 'Paint whole model gray')); const layer = paint(); assert.ok(layer?.has(1));
  act(() => useViewerStore.setState({ loading: true }));
  assert.equal(paint(), layer, 'unrelated loading is not a source change');
  act(() => useViewerStore.setState({ loading: false })); await ready(ui);
  assert.equal(paint(), layer);
});

it('does not prepare a second IFC source until the Colorizer is actually opened', async () => {
  seed(); const service = runtime(); render(<ColorizerWorkspace><p>Other panel</p></ColorizerWorkspace>);
  await act(async () => { await Promise.resolve(); });
  assert.equal(service.opens(), 0);
});

it('an unrelated schedule owner cannot invalidate paint for an unchanged IFC source', async () => {
  seed(); const service = runtime(); const ui = render(<SessionHarness />); await ready(ui);
  click(button(ui, 'Paint whole model gray')); const layer = paint(); assert.ok(layer?.has(1));
  act(() => useViewerStore.setState({ scheduleIsEdited: false, scheduleSourceModelId: 'other-model' }));
  assert.equal(paint(), layer); assert.equal(service.closes(), 0);
});

it('clears both selection channels when a group is deselected and drops stale group checks after an external pick', async () => {
  seed(); runtime(); const ui = render(<SessionHarness />); await ready(ui);
  const group = ui.querySelector<HTMLInputElement>('input[aria-label="Select group Beam"]'); assert.ok(group);
  click(group); assert.equal(group.checked, true);
  assert.deepEqual([...useViewerStore.getState().selectedEntitiesSet], ['a:1']);
  click(group);
  assert.equal(useViewerStore.getState().selectedEntitiesSet.size, 0, 'properties must not retain deselected members');
  assert.equal(useViewerStore.getState().selectedEntityIds.size, 0);
  click(group);
  act(() => useViewerStore.getState().clearSelection());
  assert.equal(group.checked, false, 'Escape / another 3D selection releases the group checkbox');
});

it('invalidates a hidden draft when its source is replaced', async () => {
  seed(); const service = runtime(); const ui = render(<SessionHarness />); await ready(ui);
  click(button(ui, 'Paint whole model gray')); click(button(ui, 'Switch panel'));
  assert.ok(paint()?.has(1));
  await act(async () => { seed(); });
  await waitFor(() => !paint(), 'stale source colour removed');
  assert.ok(service.closes() >= 1);
  click(button(ui, 'Switch panel')); await ready(ui);
  assert.equal(button(ui, 'Undo').disabled, true, 'the old source history cannot enter the replacement model');
});

it('an in-flight Save as finishes after the panel body leaves, without cancelling the source', async t => {
  seed(); let finish: ((blob: Blob) => void) | undefined, closes = 0, downloads = 0;
  host.__IFCLITE_COLORIZER__ = { async open() { return {
    catalog: async () => ({ schema: 'IFC4', productIds: [1], groups: [] }),
    export: () => new Promise<Blob>(resolve => { finish = resolve; }),
    close: async () => { closes++; },
  }; } };
  t.mock.method(URL, 'createObjectURL', () => 'blob:in-flight-colorizer');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => { downloads++; });
  const ui = render(<SessionHarness />); await ready(ui);
  click(button(ui, 'Paint whole model gray')); click(button(ui, 'Save as'));
  assert.ok(finish, 'the actual export action reached its pending native boundary');
  assert.equal(button(ui, 'Save as').disabled, true);
  click(button(ui, 'Switch panel')); assert.equal(closes, 0);
  const complete = finish;
  await act(async () => { complete(new Blob(['ISO-10303-21;END-ISO-10303-21;'])); });
  await waitFor(() => downloads === 1, 'the hidden export delivers exactly one download');
  click(button(ui, 'Switch panel')); await ready(ui);
  assert.ok(paint()?.has(1)); assert.equal(button(ui, 'Undo').disabled, false);
});
