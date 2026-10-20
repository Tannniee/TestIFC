/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { cleanup, render } from '@/test/render.js';
import { useViewerStore } from '@/store';
import { useRevealSelection } from './useRevealSelection';
import type { TreeNode } from './types';

afterEach(cleanup);
it('reveals and scrolls a selection when a pending native tree becomes ready', () => {
  useViewerStore.setState({ selectedEntityId: 7, selectionRevision: 1 });
  const node: TreeNode = { id: 'wall-7', expressIds: [7], globalIds: [7], modelIds: ['native'],
    name: 'Wall', type: 'element', depth: 1, hasChildren: false, isExpanded: false, isVisible: true };
  const calls: number[] = [];
  const virtualizer = { scrollToIndex: (index: number) => { calls.push(index); } };
  let complete!: () => void, expands = 0;
  function Probe() {
    const [ready, setReady] = useState(false);
    const [expanded, setExpanded] = useState(false);
    complete = () => setReady(true);
    useRevealSelection({ selectedEntityId: 7, groupingMode: 'spatial',
      revealGlobalId: () => {
        if (!ready) return null;
        if (!expanded) { expands++; setExpanded(true); }
        return node.id;
      }, filteredNodes: expanded ? [node] : [], storeysNodes: [], modelsNodes: [],
      isMultiModel: false, virtualizer, storeysVirtualizer: virtualizer, modelsVirtualizer: virtualizer });
    return null;
  }
  render(<Probe />);
  assert.deepEqual(calls, []);
  act(() => complete());
  assert.equal(expands, 1, 'completion retries ancestor expansion for the existing selection');
  assert.deepEqual(calls, [0], 'the selected row scrolls once after publication');
});
