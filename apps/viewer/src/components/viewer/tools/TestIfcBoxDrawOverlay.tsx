/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSceneLayer } from '../../viewport-ui/scene';
import { capturePointer, releasePointer } from '@/lib/pointer-capture';
import { cancelBoxDraw, finishBoxDraw, useTestIfcBoxUi } from '@/lib/section/testifc-box-controller';

export function TestIfcBoxDrawOverlay() {
  const phase = useTestIfcBoxUi(s => s.phase);
  const layer = useSceneLayer('dom');
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (phase === 'idle') { start.current = null; setRect(null); return; }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancelBoxDraw(); }
    };
    const blur = () => cancelBoxDraw();
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); };
  }, [phase]);
  if (!layer || phase === 'idle') return null;
  return createPortal(<div data-testid="testifc-box-draw" data-phase={phase}
    className="pointer-events-auto absolute inset-0 touch-none" style={{ cursor: phase === 'drawing' ? 'crosshair' : 'wait' }}
    onWheel={event => { event.preventDefault(); event.stopPropagation(); }}
    onPointerDown={event => {
      event.preventDefault(); event.stopPropagation();
      if (phase !== 'drawing' || event.button !== 0) return;
      start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      capturePointer(event.currentTarget, event.pointerId);
    }}
    onPointerMove={event => {
      const a = start.current;
      if (!a || a.pointerId !== event.pointerId) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      setRect({ x: Math.min(a.x, event.clientX) - bounds.left, y: Math.min(a.y, event.clientY) - bounds.top,
        width: Math.abs(event.clientX - a.x), height: Math.abs(event.clientY - a.y) });
    }}
    onPointerUp={event => {
      const a = start.current;
      if (!a || a.pointerId !== event.pointerId) return;
      start.current = null;
      releasePointer(event.currentTarget, event.pointerId);
      setRect(null);
      finishBoxDraw(a, { x: event.clientX, y: event.clientY });
    }}
    onPointerCancel={() => cancelBoxDraw()}
    onLostPointerCapture={() => { if (start.current) cancelBoxDraw(); }}>
    {rect && <div className="pointer-events-none absolute border border-overlay-accent bg-overlay-accent/10"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />}
  </div>, layer);
}
