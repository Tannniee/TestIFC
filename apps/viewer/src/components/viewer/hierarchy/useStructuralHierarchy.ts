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
export function useStructuralHierarchy(inputs: Inputs, materialReady: boolean): TreeNode[] {
  const nativeSpatial = inputs[0] === 'spatial'
    && [...inputs[1].values()].some(model => model.loadPath === 'native');
  const current = useRef(inputs);
  current.current = inputs;
  const [completed, setCompleted] = useState<{ inputs: Inputs; tree: TreeNode[] } | null>(null);
  const synchronous = useMemo(() => nativeSpatial || (inputs[0] === 'material' && !materialReady)
    ? EMPTY_TREE : buildTreeForGrouping(...inputs), [inputs, nativeSpatial, materialReady]);

  useEffect(() => {
    if (!nativeSpatial) return;
    const controller = new AbortController();
    void runCooperatively(buildTreeForGroupingSteps(...inputs), { signal: controller.signal })
      .then(tree => {
        if (!controller.signal.aborted && current.current === inputs) setCompleted({ inputs, tree });
      })
      .catch(error => {
        if (!controller.signal.aborted) console.error('[Hierarchy] spatial tree preparation failed', error);
      });
    return () => controller.abort();
  }, [inputs, nativeSpatial]);

  return nativeSpatial ? (completed?.inputs === inputs ? completed.tree : EMPTY_TREE) : synchronous;
}
