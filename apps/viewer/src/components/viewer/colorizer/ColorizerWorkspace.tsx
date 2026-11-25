/* SPDX-License-Identifier: MPL-2.0 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useColorizer } from './useColorizer';

const Context = createContext<{ tool: ReturnType<typeof useColorizer>; activate: () => () => void } | null>(null);

/** One source job and draft per viewer, independent of dock/split/window mounts.
 * Merely loading an IFC does not upload another copy for the Colorizer, and
 * with no panel mounted a model edit does not re-open the source in the
 * background: preparation waits until a panel is shown again. */
export function ColorizerWorkspace({ children }: { children: ReactNode }) {
  const [consumers, setConsumers] = useState(0);
  const activate = useCallback(() => {
    setConsumers(count => count + 1);
    return () => setConsumers(count => count - 1);
  }, []);
  const tool = useColorizer(consumers > 0);
  return <Context.Provider value={{ tool, activate }}>{children}</Context.Provider>;
}

export function useColorizerWorkspace() {
  const workspace = useContext(Context);
  const activate = workspace?.activate;
  useEffect(() => activate?.(), [activate]);
  if (!workspace) throw new Error('Colorizer must be hosted by the viewer workspace');
  return workspace.tool;
}
