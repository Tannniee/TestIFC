/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from './index.js';

test('Properties icon closes its dock and a repeated click restores it', () => {
  const s = useViewerStore.getState();
  s.showWorkspacePanel('properties');
  s.setSidebarMode('expanded');
  s.toggleWorkspacePanel('properties');
  assert.equal(useViewerStore.getState().sidebarMode, 'collapsed');
  assert.equal(useViewerStore.getState().sidebarActivePanel, 'properties');
  s.toggleWorkspacePanel('properties');
  assert.equal(useViewerStore.getState().sidebarMode, 'expanded');
  assert.equal(useViewerStore.getState().rightPanelCollapsed, false);
  s.openWorkspacePanel('clash');
  s.toggleWorkspacePanel('properties');
  assert.equal(useViewerStore.getState().sidebarActivePanel, 'properties');
  assert.equal(useViewerStore.getState().sidebarMode, 'expanded');
});
