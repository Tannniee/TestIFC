/* SPDX-License-Identifier: MPL-2.0 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle } from 'react-resizable-panels';

/** Dock Drawing beside the scene without remounting the camera or GPU device. */
export function DrawingWorkspaceSplit({ beside, drawing, children }: { beside: boolean; drawing: ReactNode; children: ReactNode }) {
  const viewport = useRef<PanelImperativeHandle>(null);
  useEffect(() => {
    if (!beside) return;
    // The optional pane must register with the group before resizing it (#6315).
    const frame = requestAnimationFrame(() => viewport.current?.resize('60%'));
    return () => cancelAnimationFrame(frame);
  }, [beside]);
  return <PanelGroup orientation="horizontal" className="h-full w-full">
    <Panel id="viewport-3d-panel" panelRef={viewport} defaultSize="60%" minSize="20%">{children}</Panel>
    {beside && <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />}
    {beside && <Panel id="drawing-side-panel" defaultSize="40%" minSize="20%">{drawing}</Panel>}
  </PanelGroup>;
}
