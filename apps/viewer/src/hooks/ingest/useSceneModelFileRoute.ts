/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback } from 'react';
import type { useIfc } from '@/hooks/useIfc';
import type { RecentFileEntry } from '@/lib/recent-files';
import type { ModelDropAction } from '@/components/viewer/modelDropAction';
import { usePreparedModelFileRoute } from './usePreparedModelFileRoute';

type SceneActions = Pick<ReturnType<typeof useIfc>, 'loadFile' | 'loadFilesSequentially' | 'clearAllModels'> & {
  resetViewerState: () => void;
  hasModelsLoaded: () => boolean;
};
type Handles = (FileSystemFileHandle | undefined)[];

/** Runs after bundle validation; an invalid/empty pick must never clear a scene. */
export function routeSceneModelFiles(files: File[], handles: Handles | undefined, action: ModelDropAction, actions: SceneActions): void {
  if (files.length === 0) return;
  if (action === 'replace') {
    actions.resetViewerState();
    actions.clearAllModels();
  }
  // Read current state AFTER asynchronous bundle preparation. An automatic
  // add must preserve any scene that arrived in the meantime.
  if (action !== 'replace' && actions.hasModelsLoaded()) {
    void actions.loadFilesSequentially(files, handles);
  } else if (files.length === 1) {
    void actions.loadFile(files[0], { kind: 'primary' }, { sourceHandle: handles?.[0] });
  } else {
    if (action !== 'replace') {
      actions.resetViewerState();
      actions.clearAllModels();
    }
    void actions.loadFilesSequentially(files, handles);
  }
}

export function useSceneModelFileRoute(actions: SceneActions, setRecentFiles?: (files: RecentFileEntry[]) => void) {
  const { loadFile, loadFilesSequentially, clearAllModels, resetViewerState, hasModelsLoaded } = actions;
  const routeAdd = useCallback((files: File[], handles?: Handles) => {
    routeSceneModelFiles(files, handles, 'add', { loadFile, loadFilesSequentially, clearAllModels, resetViewerState, hasModelsLoaded });
  }, [loadFile, loadFilesSequentially, clearAllModels, resetViewerState, hasModelsLoaded]);
  const routeReplace = useCallback((files: File[], handles?: Handles) => {
    routeSceneModelFiles(files, handles, 'replace', { loadFile, loadFilesSequentially, clearAllModels, resetViewerState, hasModelsLoaded });
  }, [loadFile, loadFilesSequentially, clearAllModels, resetViewerState, hasModelsLoaded]);
  const prepareAndRoute = usePreparedModelFileRoute(routeAdd, setRecentFiles);
  const prepareAndReplace = usePreparedModelFileRoute(routeReplace, setRecentFiles);
  return { prepareAndRoute, prepareAndReplace };
}
