/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import 'fake-indexeddb/auto';
import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { useRef } from 'react';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { cleanup, render } from '@/test/render.js';
import { ModelFileDropOverlay } from './ModelFileDropOverlay.js';
import { modelDropAction, type ModelDropAction } from './modelDropAction.js';
import { useWindowFileDrop } from './useWindowFileDrop.js';
import { routeSceneModelFiles } from '@/hooks/ingest/useSceneModelFileRoute.js';
import { prepareModelFiles } from '@/hooks/ingest/usePreparedModelFileRoute.js';

afterEach(cleanup);
const bounds = { left: 100, right: 400, top: 350, bottom: 500 };

function scene(loaded = true) {
  const calls: string[] = [];
  const actions = {
    hasModelsLoaded: () => loaded,
    resetViewerState: () => { calls.push('reset'); },
    clearAllModels: () => { calls.push('clear'); loaded = false; },
    loadFile: async (file: File, target?: { kind: string }, options?: { sourceHandle?: FileSystemFileHandle }) => {
      calls.push(`load:${target?.kind}:${file.name}:${options?.sourceHandle?.name ?? ''}`);
    },
    loadFilesSequentially: async (files: File[], handles?: (FileSystemFileHandle | undefined)[]) => {
      calls.push(`batch:${files.map(file => file.name).join(',')}:${handles?.map(handle => handle?.name).join(',') ?? ''}`);
    },
  };
  return { calls, actions };
}

describe('add or replace scene drops', () => {
  it('adds to a loaded scene without clearing it', () => {
    const { calls, actions } = scene();
    routeSceneModelFiles([new File(['IFC'], 'new.ifc')], undefined, 'add', actions);
    assert.deepEqual(calls, ['batch:new.ifc:']);
  });
  it('replaces a loaded scene using the primary loader and preserves its file handle', () => {
    const { calls, actions } = scene();
    const handle = { name: 'new.ifc' } as FileSystemFileHandle;
    routeSceneModelFiles([new File(['IFC'], 'new.ifc')], [handle], 'replace', actions);
    assert.deepEqual(calls, ['reset', 'clear', 'load:primary:new.ifc:new.ifc']);
  });
  it('replaces a federation once, then loads every new file sequentially', () => {
    const { calls, actions } = scene();
    routeSceneModelFiles([new File(['IFC'], 'a.ifc'), new File(['IFC'], 'b.ifc')], undefined, 'replace', actions);
    assert.deepEqual(calls, ['reset', 'clear', 'batch:a.ifc,b.ifc:']);
  });
  it('loads the first single model as primary and a fresh batch as a federation', () => {
    const first = scene(false);
    routeSceneModelFiles([new File(['IFC'], 'a.ifc')], undefined, 'add', first.actions);
    assert.deepEqual(first.calls, ['load:primary:a.ifc:']);
    const batch = scene(false);
    routeSceneModelFiles([new File(['IFC'], 'a.ifc'), new File(['IFC'], 'b.ifc')], undefined, 'add', batch.actions);
    assert.deepEqual(batch.calls, ['reset', 'clear', 'batch:a.ifc,b.ifc:']);
  });
  it('keeps the scene for an empty drop or a broken glTF bundle', async () => {
    const { calls, actions } = scene();
    routeSceneModelFiles([], undefined, 'replace', actions);
    const broken = new File([JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'missing.bin' }] })], 'broken.gltf');
    await assert.rejects(prepareModelFiles([broken], undefined, (files, handles) => {
      routeSceneModelFiles(files, handles, 'replace', actions);
    }), /missing/);
    assert.deepEqual(calls, []);
  });
  it('adds to a scene that arrived while bundle preparation was pending', async () => {
    let loaded = false;
    const { calls, actions } = scene(false);
    const turn = prepareModelFiles([new File(['IFC'], 'new.ifc')], undefined, (files, handles) => {
      routeSceneModelFiles(files, handles, 'add', { ...actions, hasModelsLoaded: () => loaded });
    });
    loaded = true;
    await turn;
    assert.deepEqual(calls, ['batch:new.ifc:']);
  });
  it('only the explicit lower card selects replacement', () => {
    assert.equal(modelDropAction({ clientX: 200, clientY: 400 }, bounds), 'replace');
    assert.equal(modelDropAction({ clientX: 200, clientY: 200 }, bounds), 'add');
    assert.equal(modelDropAction({ clientX: 500, clientY: 400 }, bounds), 'add');
    assert.equal(modelDropAction(undefined, bounds), 'add');
    assert.equal(modelDropAction({ clientX: 200, clientY: 400 }), 'add');
  });
});

async function drag(type: string, y: number, target: EventTarget = window, nativePriority = false) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: { types: ['Files'], files: [new File(['IFC'], 'new.ifc')], dropEffect: 'none' } },
    clientX: { value: 200 }, clientY: { value: y },
  });
  // React derives native event priority from window.event in Chromium.
  const previous = Object.getOwnPropertyDescriptor(window, 'event');
  if (nativePriority) Object.defineProperty(window, 'event', { configurable: true, value: event });
  try { await act(async () => { target.dispatchEvent(event); await new Promise(resolve => setTimeout(resolve, 0)); }); }
  finally {
    if (nativePriority && previous) Object.defineProperty(window, 'event', previous);
    else if (nativePriority) Reflect.deleteProperty(window, 'event');
  }
  return event;
}

function Harness({ onDrop }: { onDrop: (action: ModelDropAction) => void }) {
  const replaceZoneRef = useRef<HTMLDivElement>(null);
  const dragging = useWindowFileDrop((_transfer, _point, action) => {
    onDrop(action ?? 'add');
  }, true, point => modelDropAction(point, replaceZoneRef.current?.getBoundingClientRect()));
  return dragging ? <ModelFileDropOverlay modelCount={2} replaceZoneRef={replaceZoneRef} /> : null;
}

describe('window drop coordinates and overlay lifetime', () => {
  it('cleans up a child-owned drop even when propagation never reaches window bubble', async () => {
    const drops: ModelDropAction[] = [];
    const root = render(<><Harness onDrop={action => drops.push(action)} /><div data-file-drop-child /></>);
    const child = root.querySelector('[data-file-drop-child]');
    assert.ok(child);
    await drag('dragenter', 200, child);
    assert.ok(document.querySelector('[data-model-drop-action]'));
    child.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); });
    await drag('drop', 400, child, true);
    assert.deepEqual(drops, []);
    assert.equal(document.querySelector('[data-model-drop-action]'), null);
  });
  it('captures replacement before a native React flush removes the lower card', async () => {
    const drops: ModelDropAction[] = [];
    render(<Harness onDrop={action => drops.push(action)} />);
    await drag('dragenter', 200, document.body);
    const card = document.querySelector<HTMLDivElement>('[data-model-drop-action="replace"]');
    assert.ok(card);
    card.getBoundingClientRect = () => new DOMRect(100, 350, 300, 150);
    // Trusted Chromium events can commit capture-phase updates before bubble.
    // The usual act-batched synthetic drop cannot reproduce that ordering.
    document.addEventListener('drop', () => flushSync(() => {}), { capture: true, once: true });
    await drag('drop', 400, document.body, true);
    assert.deepEqual(drops, ['replace']);
    assert.equal(document.querySelector('[data-model-drop-action]'), null);
  });
  it('keeps the active card mounted across a capture-phase dragover flush', async () => {
    render(<Harness onDrop={() => {}} />);
    await drag('dragenter', 200, document.body);
    const card = document.querySelector<HTMLDivElement>('[data-model-drop-action="replace"]');
    assert.ok(card);
    card.getBoundingClientRect = () => new DOMRect(100, 350, 300, 150);
    document.addEventListener('dragover', () => flushSync(() => {}), { capture: true, once: true });
    await drag('dragover', 400, document.body, true);
    assert.equal(document.querySelector('[data-model-drop-action="replace"]'), card);
    assert.ok(card.classList.contains('ring-2'));
  });
  it('highlights the lower card and retains replacement intent before the overlay unmounts', async () => {
    const drops: ModelDropAction[] = [];
    render(<Harness onDrop={action => drops.push(action)} />);
    await drag('dragenter', 200);
    const card = document.querySelector<HTMLDivElement>('[data-model-drop-action="replace"]');
    assert.ok(card);
    card.getBoundingClientRect = () => new DOMRect(100, 350, 300, 150);
    assert.match(document.body.textContent ?? '', /Add Model to Scene.*Replace Current Scene/);
    await drag('dragover', 400);
    assert.ok(card.classList.contains('ring-2'), 'lower card shows the active target');
    const drop = await drag('drop', 400);
    assert.equal(drop.defaultPrevented, true);
    assert.deepEqual(drops, ['replace']);
    assert.equal(document.querySelector('[data-model-drop-action]'), null);
  });
  it('keeps add as the default outside the lower card and ignores text drags', async () => {
    const drops: ModelDropAction[] = [];
    render(<Harness onDrop={action => drops.push(action)} />);
    await drag('dragenter', 200);
    const card = document.querySelector<HTMLDivElement>('[data-model-drop-action="replace"]');
    assert.ok(card);
    card.getBoundingClientRect = () => new DOMRect(100, 350, 300, 150);
    await drag('dragover', 200);
    assert.ok(!card.classList.contains('ring-2'));
    await drag('drop', 200);
    assert.deepEqual(drops, ['add']);
    const text = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(text, 'dataTransfer', { value: { types: ['text/plain'] } });
    act(() => { window.dispatchEvent(text); });
    assert.equal(text.defaultPrevented, false);
    assert.deepEqual(drops, ['add']);
  });
});
