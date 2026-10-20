/* SPDX-License-Identifier: MPL-2.0 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStageInsets } from './useStageInsets';

/** The camera's surface belongs to the stage, independently of sliding docks. */
export function StableViewport({ children }: { children: ReactNode }) {
  const marker = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  useStageInsets(stage);
  useLayoutEffect(() => {
    setStage(marker.current?.closest<HTMLElement>('[data-viewer-stage]') ?? null);
  }, []);
  return <><div ref={marker} className="h-full w-full pointer-events-none" />
    {stage && createPortal(<div data-stable-viewport className="absolute inset-0 right-16 z-0">{children}</div>, stage)}
  </>;
}
