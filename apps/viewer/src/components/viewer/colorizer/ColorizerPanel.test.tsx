/* SPDX-License-Identifier: MPL-2.0 */
import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { act } from 'react';
import { render, click, cleanup, waitFor, type as typeInto } from '@/test/render';
import { fixtureModel } from '@/test/store-fixture';
import { useViewerStore } from '@/store';
import { emptyColorizerHistory, paintColorizer, colorizerBatches, undoColorizer, redoColorizer, restoreColorizer } from '@/lib/colorizer/draft';
import type { ColorizerBatch, ColorizerCatalog, ColorizerRuntime } from '@/lib/colorizer/types';
import { requestQuickPaint, useQuickPaint } from '@/lib/colorizer/quick-paint';
import { usePanelControls } from '@/hooks/usePanelControls';
import { Camera } from '@ifc-lite/renderer';
import { useTestIfcNavigation } from '../useTestIfcNavigation';
import { TestIfcQuickTools } from '../TestIfcQuickTools';
import { RibbonToolbar } from '../ribbon/RibbonToolbar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ColorizerPanel as ColorizerPanelBody } from './ColorizerPanel';
import { ColorizerWorkspace } from './ColorizerWorkspace';
import { useWorkspacePanelControls } from '../toolbar/useWorkspacePanelControls';
import { mutationPermission } from '@/store/mutation-permission';
import { ViewportStartScreen } from '../ViewportStartScreen';
import { createNativeColorizerRuntime } from '../../../../../../desktop/native-colorizer';
import type { NativeInvoke } from '../../../../../../desktop/native-client';

const initial = useViewerStore.getState();
const host = globalThis as typeof globalThis & { __IFCLITE_COLORIZER__?: ColorizerRuntime };
const previousRuntime = host.__IFCLITE_COLORIZER__;
function ColorizerPanel() { return <ColorizerWorkspace><ColorizerPanelBody /></ColorizerWorkspace>; }
const catalog: ColorizerCatalog = { schema: 'IFC4', productIds: [1, 2], groups: [
  { name: 'PIPE', source: 'geometry profile', products: [1] },
  { name: 'IPE', source: 'geometry profile', products: [2] },
] };

it('orbit selection, multi-select and PAN preserve the real camera pose after panning', () => {
  seed();
  const camera = new Camera();
  camera.setPosition(30, 20, 50); camera.setTarget(12, 3, 8);
  camera.setProjectionMode('orthographic'); camera.setAspect(1.5);
  const renderer = { current: { getCamera: () => camera, requestRender() {} } };
  useViewerStore.setState({ navigationPreset: 'testifc', activeTool: 'select', testIfcOrbitMode: 'model',
    projectionMode: 'orthographic', cameraCallbacks: { selectionBounds: () => ({ min: { x: 2, y: 0, z: 2 }, max: { x: 4, y: 5, z: 4 } }) } });
  function Tools() { useTestIfcNavigation(renderer, true); return <><canvas data-viewport="main" /><TestIfcQuickTools /></>; }
  const ui = render(<Tools />);
  camera.pan(50, 20);
  const pose = { position: { ...camera.getPosition() }, target: { ...camera.getTarget() }, orthoSize: camera.getOrthoSize() };
  for (const mode of ['selection', 'model', 'multi', 'model']) {
    const control = ui.querySelector<HTMLButtonElement>(`[data-quick-tool="${mode}"]`); assert.ok(control); click(control);
    for (let n = 0; n < 80; n++) camera.update(16);
    assert.deepEqual({ position: camera.getPosition(), target: camera.getTarget(), orthoSize: camera.getOrthoSize() }, pose, `${mode} must not frame the model`);
  }
});

it('one ribbon double-click toggles both directions, including a collapsed active tab', () => {
  seed();
  useViewerStore.setState({ ribbonTab: 'home', ribbonCollapsed: true, ribbonContextualTabs: false });
  const ui = render(<TooltipProvider><RibbonToolbar /></TooltipProvider>);
  const tab = [...ui.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Home'); assert.ok(tab);
  const doubleClick = (first = 1) => {
    for (const detail of [first, first + 1]) {
      act(() => tab.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, detail, button: 0 })));
      act(() => tab.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, detail, button: 0 })));
      act(() => tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail, button: 0 })));
    }
    act(() => tab.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2, button: 0 })));
  };
  doubleClick(); assert.equal(useViewerStore.getState().ribbonCollapsed, false);
  doubleClick(); assert.equal(useViewerStore.getState().ribbonCollapsed, true);
  doubleClick(); assert.equal(useViewerStore.getState().ribbonCollapsed, false);
  doubleClick(3); assert.equal(useViewerStore.getState().ribbonCollapsed, true, 'rapid consecutive double-click pairs each toggle');
  doubleClick(5); assert.equal(useViewerStore.getState().ribbonCollapsed, false);
});

it('right-side panels close on repeat rail activation and reopen their own content', () => {
  seed();
  function Rail() {
    const controls = usePanelControls();
    return <>{(['properties', 'model', 'appearance', 'bcf', 'validation', 'lens', 'clash', 'compare', 'sources', 'zones', 'colorizer'] as const).map(id =>
      <button key={id} aria-pressed={controls.isOpen(id)} onClick={() => controls.toggle(id)}>{id}</button>)}</>;
  }
  const ui = render(<Rail />);
  for (const id of ['properties', 'model', 'appearance', 'bcf', 'validation', 'lens', 'clash', 'compare', 'sources', 'zones', 'colorizer']) {
    act(() => useViewerStore.getState().setSidebarMode('collapsed'));
    click(button(ui, id));
    assert.equal(button(ui, id).getAttribute('aria-pressed'), 'true', `${id} opens`);
    click(button(ui, id));
    assert.equal(button(ui, id).getAttribute('aria-pressed'), 'false', `${id} closes`);
    assert.equal(useViewerStore.getState().sidebarActivePanel, id, `${id} does not switch to Properties`);
    click(button(ui, id));
    assert.equal(button(ui, id).getAttribute('aria-pressed'), 'true', `${id} reopens`);
  }
});

it('queued quick colour paints the captured five-object selection, shares undo, and exports it', async t => {
  seed();
  const five = [1, 2, 3, 4, 5];
  let batches: ColorizerBatch[] | undefined;
  host.__IFCLITE_COLORIZER__ = { async open() { return {
    catalog: async () => ({ ...catalog, productIds: [...five, 6] }),
    export: async value => { batches = value; return new Blob(['IFC']); }, close: async () => {},
  }; } };
  t.mock.method(URL, 'createObjectURL', () => 'blob:quick-test');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  useViewerStore.getState().setSelectedEntityIds([...five, 1001]);
  requestQuickPaint(3, '#0088ff');
  // Selection changes while source preparation is pending must not retarget paint.
  useViewerStore.getState().setSelectedEntityIds([6]);
  const ui = render(<ColorizerPanel />);
  await waitFor(() => paintMap()?.size === 5, 'five captured objects are painted');
  assert.deepEqual([...paintMap()!.keys()], five);
  assert.equal(paintMap()?.has(1001), false, 'another model is not accidentally painted');
  assert.equal(paintMap()?.has(6), false, 'a later selection is not painted');
  click(button(ui, 'Undo')); assert.equal(paintMap(), undefined);
  click(button(ui, 'Redo')); assert.equal(paintMap()?.size, 5);
  click(button(ui, 'Save as'));
  await waitFor(() => !!batches, 'quick paint reaches the same IFC export');
  assert.deepEqual(batches, [{ products: five, color: [0, 136 / 255, 1, 1] }]);
});

it('regrouping retains the same preview layer and keeps the group picker in place', async () => {
  seed();
  host.__IFCLITE_COLORIZER__ = { async open() { return {
    catalog: async grouping => grouping.mode === 'class' ? { ...catalog, groups: [{ name: 'IfcBeam', source: 'class', products: [1, 2] }] } : catalog,
    export: async () => new Blob(), close: async () => {},
  }; } };
  const ui = render(<ColorizerPanel />);
  await waitFor(() => !!ui.querySelector('input[aria-label="Select group PIPE"]'), 'groups ready');
  click(button(ui, 'Paint whole model gray'));
  const layer = useViewerStore.getState().overlayLayers.get('colorizer-preview');
  const selector = [...ui.querySelectorAll('select')].find(input => input.value === 'section'); assert.ok(selector);
  act(() => { selector.value = 'class'; selector.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await waitFor(() => !!ui.querySelector('input[aria-label="Select group IfcBeam"]'), 'class groups ready');
  assert.equal(useViewerStore.getState().overlayLayers.get('colorizer-preview'), layer, 'regroup does not upload identical paint again');
});

afterEach(() => {
  cleanup(); useQuickPaint.setState({ requests: [] }); host.__IFCLITE_COLORIZER__ = previousRuntime;
  useViewerStore.setState(initial);
});

function seed() {
  const a = { ...fixtureModel('a'), maxExpressId: 100, schemaVersion: 'IFC4' as const,
    sourceFile: new File(['ISO-10303-21;'], 'a.ifc') };
  const b = { ...fixtureModel('b', { idOffset: 1000 }), maxExpressId: 100, schemaVersion: 'IFC4' as const,
    sourceFile: new File(['ISO-10303-21;'], 'b.ifc') };
  useViewerStore.setState({ models: new Map([['a', a], ['b', b]]), activeModelId: 'a',
    editEnabled: false, collabRole: null, loading: false, mutationViews: new Map(), georefMutations: new Map(),
    selectedEntityIds: new Set(), overlayLayers: new Map(), isolatedEntities: new Set([1]) });
}
function button(ui: HTMLElement, text: string): HTMLButtonElement {
  const result = [...ui.querySelectorAll('button')].find(button => button.textContent === text);
  assert.ok(result, `button ${text}`); return result;
}
function paintMap() { return useViewerStore.getState().overlayLayers.get('colorizer-preview')?.colorOverrides; }

it('Colorizer draft uses last paint, compiles disjoint export batches, and supports undo/redo', () => {
  let history = paintColorizer(emptyColorizerHistory(), [{ products: [1, 2], color: [0.5, 0.5, 0.5, 1] }]);
  history = paintColorizer(history, [{ products: [1], color: [1, 0, 0, 1] }]);
  assert.deepEqual(colorizerBatches(history.present), [
    { products: [1], color: [1, 0, 0, 1] }, { products: [2], color: [0.5, 0.5, 0.5, 1] },
  ]);
  assert.deepEqual(undoColorizer(history).present.get(1), [0.5, 0.5, 0.5, 1]);
  assert.deepEqual(redoColorizer(undoColorizer(history)).present.get(1), [1, 0, 0, 1]);
  assert.equal(restoreColorizer(history).present.size, 0);
  assert.throws(() => paintColorizer(history, [{ products: [1], color: [NaN, 0, 0, 1] }]));
});

it('mounted Colorizer paints a group red over full-model gray and exports hidden objects too', async t => {
  seed();
  let exported: ColorizerBatch[] | null = null;
  let closed = 0;
  host.__IFCLITE_COLORIZER__ = { async open() { return {
    catalog: async () => catalog,
    export: async batches => { exported = batches; return new Blob(['IFC output']); },
    close: async () => { closed++; },
  }; } };
  t.mock.method(URL, 'createObjectURL', () => 'blob:colorizer-test');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  const ui = render(<ColorizerPanel />);
  await waitFor(() => !!ui.querySelector('input[aria-label="Select group PIPE"]'), 'catalog is mounted');
  click(button(ui, 'Paint whole model gray'));
  assert.deepEqual(paintMap()?.get(1), [128 / 255, 128 / 255, 128 / 255, 1]);
  const group = ui.querySelector<HTMLInputElement>('input[aria-label="Select group PIPE"]');
  assert.ok(group); click(group);
  assert.deepEqual([...useViewerStore.getState().selectedEntityIds], [1], 'checking a group highlights its actual products');
  const options = ui.querySelector('summary'); assert.ok(options); click(options);
  const alpha = ui.querySelector<HTMLInputElement>('input[type="number"]'); assert.ok(alpha);
  typeInto(alpha, '50');
  click(button(ui, 'Apply colour (1)'));
  assert.deepEqual(paintMap()?.get(1), [1, 0, 0, 1]);
  assert.deepEqual(paintMap()?.get(2), [128 / 255, 128 / 255, 128 / 255, 1]);
  assert.equal(paintMap()?.has(1001), false, 'the other model is not painted');
  click(button(ui, 'Undo'));
  assert.deepEqual(paintMap()?.get(1), [128 / 255, 128 / 255, 128 / 255, 1]);
  click(button(ui, 'Redo'));
  click(button(ui, 'Save as'));
  await waitFor(() => exported !== null, 'export receives final colours');
  assert.deepEqual(exported, [
    { products: [1], color: [1, 0, 0, 0.5] },
    { products: [2], color: [128 / 255, 128 / 255, 128 / 255, 1] },
  ]);
  await waitFor(() => !button(ui, 'Save as').disabled, 'export finishes');
  cleanup();
  assert.equal(paintMap(), undefined, 'unmount removes the owned preview');
  assert.ok(closed >= 1);
});

it('Colorizer ribbon control opens the flag-free panel and keeps its active latch', () => {
  seed();
  useViewerStore.setState({ sidebarActivePanel: 'model', sidebarMode: 'expanded', floatingPanels: [], poppedOutIds: [] });
  function RibbonControl() {
    const controls = useWorkspacePanelControls('ribbon');
    const active = controls.activeWorkspacePanels.has('colorizer');
    return <><button type="button" aria-pressed={active} onClick={() => controls.handleToggleRightPanel('colorizer')}>Open Colorizer</button>
      {active && <ColorizerPanel />}</>;
  }
  const ui = render(<RibbonControl />);
  click(button(ui, 'Open Colorizer'));
  assert.ok(ui.querySelector('section[aria-label="Colorizer"]'));
  assert.equal(button(ui, 'Open Colorizer').getAttribute('aria-pressed'), 'true');
  click(button(ui, 'Open Colorizer'));
  assert.equal(ui.querySelector('section[aria-label="Colorizer"]'), null);
  assert.equal(useViewerStore.getState().sidebarActivePanel, 'colorizer', 'closing does not open Properties');
  assert.equal(useViewerStore.getState().sidebarMode, 'collapsed');
  click(button(ui, 'Open Colorizer'));
  assert.ok(ui.querySelector('section[aria-label="Colorizer"]'), 'a third click reopens the same panel');
});

it('mounted Colorizer drops stale source results and does not publish after cancellation', async () => {
  seed();
  let resolveCatalog: ((value: ColorizerCatalog) => void) | undefined;
  host.__IFCLITE_COLORIZER__ = { async open() { return {
    catalog: () => new Promise(resolve => { resolveCatalog = resolve; }),
    export: async () => { throw new Error('stale export must never run'); },
    close: async () => {},
  }; } };
  const ui = render(<ColorizerPanel />);
  await waitFor(() => !!resolveCatalog, 'catalog starts');
  click(button(ui, 'Cancel'));
  await act(async () => resolveCatalog?.(catalog));
  assert.equal(ui.querySelector('input[aria-label="Select group PIPE"]'), null);
  assert.equal(paintMap(), undefined);
  assert.ok(button(ui, 'Try again'), 'a cancelled automatic read can be resumed');
  click(button(ui, 'Try again'));
  await waitFor(() => button(ui, 'Cancel') !== undefined, 'retry starts a new read');
  await act(async () => resolveCatalog?.(catalog));
  await waitFor(() => !!ui.querySelector('input[aria-label="Select group PIPE"]'), 'retry publishes the new groups');
});

it('mounted Colorizer invalidates its preview when the source model is replaced', async () => {
  seed();
  host.__IFCLITE_COLORIZER__ = { async open() { return {
    catalog: async () => catalog, export: async () => new Blob(), close: async () => {},
  }; } };
  const ui = render(<ColorizerPanel />);
  await waitFor(() => !!ui.querySelector('input[aria-label="Select group PIPE"]'), 'catalog is mounted');
  click(button(ui, 'Paint whole model gray'));
  act(() => {
    const state = useViewerStore.getState();
    const model = state.models.get('a'); assert.ok(model);
    useViewerStore.setState({ models: new Map(state.models).set('a', { ...model, sourceFile: new File(['different'], 'a.ifc') }) });
  });
  assert.equal(paintMap(), undefined);
  assert.equal(button(ui, 'Save as').disabled, true);
});

it('Colorizer reads a single open IFC automatically without the Model workspace', async () => {
  seed();
  const a = useViewerStore.getState().models.get('a'); assert.ok(a);
  useViewerStore.setState({ models: new Map([['a', a]]) });
  let opens = 0;
  host.__IFCLITE_COLORIZER__ = { async open() { opens++; return {
    catalog: async () => catalog, export: async () => new Blob(), close: async () => {},
  }; } };
  const ui = render(<ColorizerPanel />);
  await waitFor(() => !!ui.querySelector('input[aria-label="Select group PIPE"]'), 'groups load without a prepare button');
  assert.equal(opens, 1);
  assert.equal(ui.textContent?.includes('Prepare model'), false);
  assert.equal(ui.textContent?.includes('Turn on Edit mode'), false);
  assert.equal(ui.textContent?.includes('IFC file'), false, 'one file has no model dropdown');
  assert.equal(useViewerStore.getState().editEnabled, false);
  assert.deepEqual(mutationPermission(useViewerStore.getState(), 'a'), { allowed: false, reason: 'edit-mode' }, 'normal model editing still requires edit mode');
  click(button(ui, 'Paint whole model gray'));
  assert.equal(paintMap()?.size, 2);
});

it('Colorizer still denies shared-session viewers while edit mode is unnecessary', async () => {
  seed();
  useViewerStore.setState({ collabRole: 'viewer' });
  let opens = 0;
  host.__IFCLITE_COLORIZER__ = { async open() { opens++; throw new Error('viewer must not open an editing source'); } };
  const ui = render(<ColorizerPanel />);
  await act(async () => {});
  assert.equal(opens, 0);
  assert.equal(button(ui, 'Paint whole model gray').disabled, true);
  assert.match(ui.textContent ?? '', /Editing is disabled for your role/);
});

it('Colorizer paints five individually picked members across different groups and excludes the other model', async t => {
  seed();
  const ids = [11,35,54,67,89,101];
  const a = { ...fixtureModel('a', { idOffset: 2000, entities: ids.map(expressId => ({ expressId, type: 'IfcBeam' })) }),
    maxExpressId:101, schemaVersion: 'IFC4' as const, sourceFile: new File(['IFC'], 'a.ifc') };
  const b = { ...fixtureModel('b', { idOffset: 4000, entities: [{ expressId:11,type:'IfcBeam' }] }),
    maxExpressId:11, schemaVersion: 'IFC4' as const, sourceFile: new File(['IFC'], 'b.ifc') };
  useViewerStore.setState({ models: new Map([['a',a],['b',b]]), activeModelId:'a',
    selectedEntityIds: new Set([2011,2035,2054,2067,2089,4011]) });
  let exported: ColorizerBatch[] | undefined;
  host.__IFCLITE_COLORIZER__ = { async open() { return {
    catalog: async () => ({ schema:'IFC4', productIds:ids, groups: ids.map(id => ({ name:`Section ${id}`,source:'profile',products:[id] })) }),
    export: async batches => { exported = batches; return new Blob(['IFC']); }, close: async () => {},
  }; } };
  t.mock.method(URL, 'createObjectURL', () => 'blob:five-picked');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  const ui = render(<ColorizerPanel />);
  await waitFor(() => !!ui.querySelector('input[aria-label="Select group Section 11"]'), 'six different sections loaded');
  click(button(ui, 'Paint whole model gray'));
  click(button(ui, 'Paint 3D selection'));
  for (const id of [2011,2035,2054,2067,2089]) assert.deepEqual(paintMap()?.get(id),[1,0,0,1]);
  assert.deepEqual(paintMap()?.get(2101),[128/255,128/255,128/255,1], 'unselected member stays gray');
  assert.equal(paintMap()?.has(4011),false, 'the other model is not recoloured');
  click(button(ui, 'Save as'));
  await waitFor(() => exported !== undefined, 'selected members reach the export');
  assert.deepEqual(exported?.find(batch => batch.color[0] === 1)?.products,[11,35,54,67,89]);
  await waitFor(() => !button(ui, 'Save as').disabled, 'download finished');
});

it('native start screen opens the file picker without the introduction or tour', () => {
  const desktopHost = globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown };
  const previous = desktopHost.__TAURI_INTERNALS__;
  desktopHost.__TAURI_INTERNALS__ = {};
  let opens = 0;
  try {
    const ui = render(<ViewportStartScreen webgpu={{ supported: true, checking: false }}
      onOpenClick={() => { opens++; }} onStartBlank={() => { throw new Error('unexpected blank model'); }} recentFiles={[]} loadFile={async () => { throw new Error('unexpected demo load'); }} />);
    assert.equal(ui.querySelectorAll('button').length, 1);
    assert.equal(ui.textContent?.includes('IFClite'), false);
    click(button(ui, 'Open IFC file'));
    assert.equal(opens, 1);
  } finally { desktopHost.__TAURI_INTERNALS__ = previous; }
});

it('Colorizer native upload is chunked and abort closes exactly its own source job', async () => {
  const controller = new AbortController();
  const sizes: number[] = [];
  let closes = 0;
  const invoke: NativeInvoke = async <T,>(command: string, args?: Record<string, unknown> | Uint8Array): Promise<T> => {
    if (command === 'native_create_job') return 'owned-job' as T;
    if (command === 'native_close_job') { closes++; return undefined as T; }
    if (command === 'native_append_source') {
      assert.ok(args instanceof Uint8Array); sizes.push(args.byteLength); controller.abort(); return undefined as T;
    }
    throw new Error(`Unexpected command ${command}`);
  };
  const runtime = createNativeColorizerRuntime(invoke);
  await assert.rejects(runtime.open(new Blob([new Uint8Array(3 * 1024 * 1024)]), '{"mutations":[]}', { signal: controller.signal }));
  assert.deepEqual(sizes, [2 * 1024 * 1024]);
  assert.equal(closes, 1);
});

it('Colorizer native export refuses truncated bytes before creating a download', async () => {
  const controller = new AbortController();
  let packet = 0;
  const invoke: NativeInvoke = async <T,>(command: string): Promise<T> => {
    if (command === 'native_create_job') return 'job' as T;
    if (command === 'native_colorizer_export') return 4 as T;
    if (command === 'native_colorizer_next_packet') return (packet++ ? new ArrayBuffer(0) : new ArrayBuffer(3)) as T;
    return undefined as T;
  };
  const session = await createNativeColorizerRuntime(invoke).open(new Blob(), '{"mutations":[]}', { signal: controller.signal });
  try { await assert.rejects(session.export([]), /Incomplete Colorizer download/); }
  finally { await session.close(); }
});

it('Colorizer native transport rejects overlapping downloads from one session', async () => {
  let finish: ((length: number) => void) | undefined;
  let packet = 0;
  const invoke: NativeInvoke = async <T,>(command: string): Promise<T> => {
    if (command === 'native_create_job') return 'job' as T;
    if (command === 'native_colorizer_export') return await new Promise<number>(resolve => { finish = resolve; }) as T;
    if (command === 'native_colorizer_next_packet') return new ArrayBuffer(packet++ ? 0 : 4) as T;
    return undefined as T;
  };
  const session = await createNativeColorizerRuntime(invoke).open(new Blob(), '{"mutations":[]}', { signal: new AbortController().signal });
  try {
    const first = session.export([]);
    await assert.rejects(session.export([]), /already in progress/);
    assert.ok(finish); finish(4);
    assert.equal((await first).size, 4);
  } finally { await session.close(); }
});
