/* SPDX-License-Identifier: MPL-2.0 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useColorizer } from './useColorizer';

const Context = createContext<{ tool: ReturnType<typeof useColorizer>; activate: () => void } | null>(null);

/** One source job and draft per viewer, independent of dock/split/window mounts.
 * Merely loading an IFC does not upload another copy for the Colorizer. */
export function ColorizerWorkspace({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const activate = useCallback(() => setEnabled(true), []);
  const tool = useColorizer(enabled);
  return <Context.Provider value={{ tool, activate }}>{children}</Context.Provider>;
}

export function useColorizerWorkspace() {
  const workspace = useContext(Context);
  useEffect(() => { workspace?.activate(); }, [workspace?.activate]);
  if (!workspace) throw new Error('Colorizer must be hosted by the viewer workspace');
  return workspace.tool;
}
