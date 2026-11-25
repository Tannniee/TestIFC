/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Workspace-panel toggling for the ribbon's Analyze / Author tabs.
 * Encodes the single-tenant right-slot and bottom-slot rules plus
 * analysis-extension handoff.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useViewerStore } from '@/store';
import {
  closeActiveAnalysisExtension,
  getAnalysisExtensionsSnapshot,
  openAnalysisExtension,
  subscribeAnalysisExtensions,
} from '@/services/analysis-extensions';
import { BOTTOM_PANEL_IDS, isBottomPanelOpen, type BottomPanelId } from '@/lib/panels/bottom-panels';
import { useBottomPanelFlags } from '@/hooks/useBottomPanelFlags';
import { type UiSurface } from '@/store/uiTelemetry';

/** Registry ids, deliberately. This hook used to spell the entity-list panel
 *  `'list'` while the registry and the store spell it `'lists'`, and the cost
 *  was structural rather than cosmetic: with ids that did not match, the bottom
 *  branch below could not simply hand the click to the store, so it re-derived
 *  the flag flips and lost the float / pop-out cleanup along the way. */
export type BottomPanel = BottomPanelId;
export type RightPanel = 'bcf' | 'validation' | 'lens' | 'clash' | 'compare' | 'extensions' | 'sources' | 'appearance' | 'colorizer';
export type WorkspacePanel = BottomPanel | RightPanel | string;

/** `surface`: the chrome these controls sit in, reported with each open (#5618). */
export function useWorkspacePanelControls(surface?: UiSurface) {
  const setBcfPanelVisible = useViewerStore((state) => state.setBcfPanelVisible);
  const setIdsPanelVisible = useViewerStore((state) => state.setIdsPanelVisible);
  const setClashPanelVisible = useViewerStore((state) => state.setClashPanelVisible);
  const setComparePanelVisible = useViewerStore((state) => state.setComparePanelVisible);
  const setListPanelVisible = useViewerStore((state) => state.setListPanelVisible);
  const setLensPanelVisible = useViewerStore((state) => state.setLensPanelVisible);
  const setExtensionsPanelVisible = useViewerStore((state) => state.setExtensionsPanelVisible);
  const setSourcesPanelVisible = useViewerStore((state) => state.setSourcesPanelVisible);
  const setScriptPanelVisible = useViewerStore((state) => state.setScriptPanelVisible);
  // Every bottom-strip flag from the table, so a new bottom panel needs no row here.
  const bottomFlags = useBottomPanelFlags();
  const setGanttPanelVisible = useViewerStore((state) => state.setGanttPanelVisible);
  // The detached channels — a panel living in one of these is open regardless
  // of its dock flag (see `activeWorkspacePanels`).
  const floatingPanels = useViewerStore((state) => state.floatingPanels);
  const poppedOutIds = useViewerStore((state) => state.poppedOutIds);
  // Zones (#1810) has no dedicated visibility flag — it is a pure sidebar
  // panel, driven by `sidebarActivePanel`. Reading it HERE rather than in each
  // hook keeps the ribbon's Zones button in sync with the active panel (#2508).
  const sidebarActivePanel = useViewerStore((state) => state.sidebarActivePanel);
  const sidebarMode = useViewerStore((state) => state.sidebarMode);
  const rightPanelCollapsed = useViewerStore((state) => state.rightPanelCollapsed);
  const setRightPanelCollapsed = useViewerStore((state) => state.setRightPanelCollapsed);

  const analysisExtensionState = useSyncExternalStore(
    subscribeAnalysisExtensions,
    getAnalysisExtensionsSnapshot,
    getAnalysisExtensionsSnapshot,
  );
  const activeAnalysisExtension = useMemo(
    () => analysisExtensionState.extensions.find((extension) => extension.id === analysisExtensionState.activeId) ?? null,
    [analysisExtensionState.activeId, analysisExtensionState.extensions],
  );
  const rightAnalysisExtensions = useMemo(
    () => analysisExtensionState.extensions.filter((extension) => (extension.placement ?? 'right') === 'right'),
    [analysisExtensionState.extensions],
  );
  const bottomAnalysisExtensions = useMemo(
    () => analysisExtensionState.extensions.filter((extension) => (extension.placement ?? 'right') === 'bottom'),
    [analysisExtensionState.extensions],
  );

  const handleToggleBottomPanel = useCallback((panel: BottomPanel) => {
    if (activeAnalysisExtension?.placement === 'bottom') {
      closeActiveAnalysisExtension();
    }
    // The store owns the bottom strip's re-dock rules, so hand it the click
    // rather than re-deriving the flag flips. The copy that used to live here
    // knew nothing about the float / pop-out channels: toggling a FLOATING
    // Lists panel cleared its dock flag and left the floating window on screen
    // with the toolbar latch off, while the same click from the activity bar
    // (which routes here) brought it home correctly.
    useViewerStore.getState().toggleBottomPanel(panel, surface);
  }, [activeAnalysisExtension?.placement, surface]);

  const handleToggleRightPanel = useCallback((panel: RightPanel) => {
    if (activeAnalysisExtension?.placement !== 'bottom') {
      closeActiveAnalysisExtension();
    }
    useViewerStore.getState().toggleWorkspacePanel(panel, surface);
  }, [activeAnalysisExtension?.placement, surface]);

  const handleToggleAnalysisExtension = useCallback((id: string) => {
    const extension = analysisExtensionState.extensions.find((candidate) => candidate.id === id);
    if (!extension) {
      return;
    }

    if (analysisExtensionState.activeId === id) {
      closeActiveAnalysisExtension();
      return;
    }

    const opened = openAnalysisExtension(id);
    if (!opened) {
      return;
    }

    if ((extension.placement ?? 'right') === 'bottom') {
      setScriptPanelVisible(false);
      setListPanelVisible(false);
      setGanttPanelVisible(false);
      setRightPanelCollapsed(false);
      return;
    }

    setBcfPanelVisible(false);
    setIdsPanelVisible(false);
    setLensPanelVisible(false);
    setClashPanelVisible(false);
    setComparePanelVisible(false);
    setExtensionsPanelVisible(false);
    setSourcesPanelVisible(false);
    setRightPanelCollapsed(false);
  }, [
    analysisExtensionState.activeId,
    analysisExtensionState.extensions,
    setBcfPanelVisible,
    setClashPanelVisible,
    setComparePanelVisible,
    setExtensionsPanelVisible,
    setGanttPanelVisible,
    setIdsPanelVisible,
    setLensPanelVisible,
    setListPanelVisible,
    setRightPanelCollapsed,
    setScriptPanelVisible,
    setSourcesPanelVisible,
  ]);

  const activeWorkspacePanels = useMemo(() => {
    const panels = new Set<WorkspacePanel>();
    // A floating or popped-out panel is OPEN — the sidebar's single-tenant rule
    // clears its dock flag the moment another panel docks, without touching the
    // detached channels. Reading only the flags is what made a floating BCF
    // panel's latch go dark on both toolbars while the panel sat on screen; the
    // activity bar never had the bug because it reads `panelLocation`.
    for (const panel of floatingPanels) panels.add(panel.id);
    for (const id of poppedOutIds) panels.add(id);
    for (const id of BOTTOM_PANEL_IDS) if (isBottomPanelOpen(bottomFlags, id)) panels.add(id);
    if (sidebarMode === 'expanded' && !rightPanelCollapsed) panels.add(sidebarActivePanel);
    if (analysisExtensionState.activeId) panels.add(analysisExtensionState.activeId);
    return panels;
  }, [
    analysisExtensionState.activeId,
    bottomFlags,
    floatingPanels,
    poppedOutIds,
    sidebarActivePanel,
    sidebarMode,
    rightPanelCollapsed,
  ]);

  return {
    activeWorkspacePanels,
    handleToggleBottomPanel,
    handleToggleRightPanel,
    handleToggleAnalysisExtension,
    rightAnalysisExtensions,
    bottomAnalysisExtensions,
  };
}
