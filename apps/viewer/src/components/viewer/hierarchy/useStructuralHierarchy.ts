/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { runCooperatively } from '@/utils/runCooperatively';
import { buildTreeForGrouping, buildTreeForGroupingSteps } from './revealGlobalId';
import type { TreeNode } from './types';

type Inputs = Parameters<typeof buildTreeForGrouping>;
const EMPTY_TREE: TreeNode[] = [];

/** Keep native spatial construction out of render; consumers see a complete
 * snapshot for exactly their current inputs, never a partial or stale model. */
export function useStructuralHierarchy(inputs: Inputs, builderReady: boolean, nativeOnly = false): TreeNode[] {
  const nativeSpatial = inputs[0] === 'spatial'
    && [...inputs[1].values()].some(model => model.loadPath === 'native');
  const current = useRef(inputs);
  current.current = inputs;
  const [completed, setCompleted] = useState<{ inputs: Inputs; tree: TreeNode[] } | null>(null);
  const synchronous = useMemo(() => nativeSpatial || !builderReady || nativeOnly
    ? EMPTY_TREE : buildTreeForGrouping(...inputs), [inputs, nativeSpatial, builderReady, nativeOnly]);

  useEffect(() => {
    if (!nativeSpatial || !builderReady) return;
    const controller = new AbortController();
    void runCooperatively(buildTreeForGroupingSteps(...inputs), { signal: controller.signal })
      .then(tree => {
        if (!controller.signal.aborted && current.current === inputs) setCompleted({ inputs, tree });
      })
      .catch(error => {
        if (!controller.signal.aborted) console.error('[Hierarchy] spatial tree preparation failed', error);
      });
    return () => controller.abort();
  }, [inputs, nativeSpatial, builderReady]);

  if (!builderReady) return EMPTY_TREE;
  if (!nativeSpatial) return synchronous;
  if (!completed) return EMPTY_TREE;
  // A rebuild for the SAME loaded models (an edit, geometry readiness, locale)
  // keeps the previous rows on screen instead of blanking the panel and losing
  // its scroll position. A different model set never shows the old rows.
  return completed.inputs === inputs || sameModels(completed.inputs, inputs) ? completed.tree : EMPTY_TREE;
}

function sameModels(a: Inputs, b: Inputs): boolean {
  if (a[0] !== b[0] || a[1].size !== b[1].size) return false;
  for (const [id, model] of b[1]) {
    const previous = a[1].get(id);
    if (!previous || previous.ifcDataStore !== model.ifcDataStore) return false;
  }
  return true;
}
