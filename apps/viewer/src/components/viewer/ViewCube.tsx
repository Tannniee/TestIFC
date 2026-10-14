/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { CameraViewpoint } from '@/store/types';
import { cubeOrientation, namedCubeView } from './viewcube-camera';
import {
  VIEW_CUBE_SURFACES, VIEW_CUBE_QUICK_VIEWS, VIEW_CUBE_DRAG_THRESHOLD,
  currentDirectionKey, directionKey, faceLabelTransform, orientationTransform,
  surfaceClass, surfaceName, viewNames, type ViewCubeText, type ViewDirection,
} from './viewcube-math';

interface ViewCubeProps {
  onViewChange?: (view: string) => void;
  onDirection?: (direction: ViewDirection) => void;
  onHome?: () => void;
  onDrag?: (deltaX: number, deltaY: number) => void;
  rotationX?: number;
  rotationY?: number;
  disabled?: boolean;
}
export interface ViewCubeRef {
  updateRotation: (x: number, y: number, pose?: CameraViewpoint | null) => void;
}
const TEXT: ViewCubeText = {
  viewCube: 'ViewCube', directions: 'Model view directions', quickViews: 'Quick views',
  viewFrom: 'View from', edge: 'Edge', corner: 'Corner', left: 'Left', right: 'Right',
  back: 'Back', front: 'Front', top: 'Top', bottom: 'Bottom', homeIso: 'Home / Isometric',
};
export const FACE_VIEWS = { front: { rx: 0, ry: 0 }, back: { rx: 0, ry: 180 }, top: { rx: -90, ry: 0 },
  bottom: { rx: 90, ry: 0 }, right: { rx: 0, ry: -90 }, left: { rx: 0, ry: 90 } };

export const ViewCube = forwardRef<ViewCubeRef, ViewCubeProps>(({
  onViewChange, onDirection, onHome, onDrag, rotationX = -25, rotationY = -45, disabled = false,
}, ref) => {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number; distance: number; dragged: boolean; direction?: ViewDirection } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const orientation = useRef(cubeOrientation(rotationX, rotationY));
  const callbacks = useRef({ onViewChange, onDirection, onDrag, disabled });
  callbacks.current = { onViewChange, onDirection, onDrag, disabled };

  const update = useCallback((x: number, y: number, pose?: CameraViewpoint | null) => {
    orientation.current = cubeOrientation(x, y, pose);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!body.current || !root.current) return;
      const value = orientation.current;
      body.current.style.transform = orientationTransform(value);
      const active = currentDirectionKey(value);
      body.current.classList.toggle('has-active', !!active);
      for (const button of root.current.querySelectorAll<HTMLButtonElement>('[data-cube-key]')) {
        const selected = active === button.dataset.cubeKey;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
      }
      for (const surface of VIEW_CUBE_SURFACES.filter(s => s.kind === 'face')) {
        const label = body.current.querySelector<HTMLElement>(`[data-direction-key="${surface.key}"] .view-cube__label`);
        if (label) label.style.transform = faceLabelTransform(surface, value) ?? '';
      }
    });
  }, []);
  useImperativeHandle(ref, () => ({ updateRotation: update }), [update]);
  useEffect(() => {
    update(rotationX, rotationY);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [update, rotationX, rotationY]);

  const activate = useCallback((direction: ViewDirection) => {
    if (callbacks.current.disabled) return;
    const named = namedCubeView(direction);
    if (named) callbacks.current.onViewChange?.(named);
    else callbacks.current.onDirection?.(direction);
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const press = pointer.current;
      if (!press || event.pointerId !== press.id || callbacks.current.disabled) return;
      const dx = event.clientX - press.x, dy = event.clientY - press.y;
      press.x = event.clientX; press.y = event.clientY;
      press.distance += Math.hypot(dx, dy);
      if (press.distance <= VIEW_CUBE_DRAG_THRESHOLD) return;
      press.dragged = true;
      setDragging(true); setHovered(null);
      event.preventDefault();
      callbacks.current.onDrag?.(dx * 2, dy * 2); // Native IFC-Lite orbit takes pixel deltas.
    };
    const end = (event: PointerEvent) => {
      const press = pointer.current;
      if (!press || event.pointerId !== press.id) return;
      pointer.current = null; setDragging(false);
      if (event.type === 'pointerup' && !press.dragged && press.direction) activate(press.direction);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [activate]);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-direction-key]');
    const surface = VIEW_CUBE_SURFACES.find(s => s.key === button?.dataset.directionKey);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, dragged: false, direction: surface?.direction };
  }

  const activeKey = currentDirectionKey(orientation.current);
  return <div ref={root} className="testifc-viewcube" data-testid="viewcube-navigation">
    <div className={`view-nav-cluster${disabled ? ' disabled' : ''}`} role="group" aria-label={TEXT.viewCube}>
      <div className="view-cube__panel"><div className="view-cube">
        <div className={`view-cube__stage${dragging ? ' is-dragging' : ''}`} role="group" aria-label={TEXT.directions} onPointerDown={down}>
          <div ref={body} className={`view-cube__body${activeKey ? ' has-active' : ''}`} style={{ transform: orientationTransform(orientation.current) }}>
            {VIEW_CUBE_SURFACES.map(surface => {
              const style: CSSProperties = {
                width: surface.width, height: surface.height, marginLeft: -surface.width / 2,
                marginTop: -surface.height * (surface.originY ?? .5), transformOrigin: `50% ${(surface.originY ?? .5) * 100}%`,
                transform: surface.transform, clipPath: surface.clipPath,
              };
              return <button key={surface.key} type="button" disabled={disabled} style={style}
                className={`${surfaceClass(surface)}${hovered === surface.key ? ' is-hovered' : ''}${activeKey === surface.key ? ' is-active' : ''}`}
                data-axis={surface.axis} data-direction-key={surface.key} data-cube-key={surface.key}
                aria-label={`${TEXT.viewFrom} ${surfaceName(surface, TEXT)}`} title={surfaceName(surface, TEXT)}
                aria-pressed={activeKey === surface.key}
                onClick={event => { if (event.detail === 0) activate(surface.direction); }}
                onMouseEnter={() => setHovered(surface.key)} onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(surface.key)} onBlur={() => setHovered(null)}>
                {surface.kind === 'face' && <span className="view-cube__label" style={{ transform: faceLabelTransform(surface, orientation.current) }}>{surface.label}</span>}
              </button>;
            })}
          </div>
        </div>
      </div></div>
      <div className="view-controls" role="group" aria-label={TEXT.quickViews}>
        {VIEW_CUBE_QUICK_VIEWS.map(view => <button key={view.className} type="button" disabled={disabled}
          className={`view-control-button ${view.className}${activeKey === directionKey(view.direction) ? ' is-active' : ''}`} data-cube-key={directionKey(view.direction)}
          aria-pressed={activeKey === directionKey(view.direction)}
          aria-label={`${TEXT.viewFrom} ${viewNames(view.direction, TEXT).join(' / ')}`}
          data-tooltip={viewNames(view.direction, TEXT).join(' / ')} onClick={() => activate(view.direction)}
          onMouseEnter={() => setHovered(directionKey(view.direction))} onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(directionKey(view.direction))} onBlur={() => setHovered(null)}>
          <svg className="mini-cube" viewBox="0 0 24 24" aria-hidden="true">
            <polygon className="face-highlight" points={view.highlight} />
            <path className="cube-hidden" d="M9 4H19.5V15.5H9Z" />
            <path className="cube-edge" d="M4.5 8H15V20H4.5Z M9 4H19.5V15.5 M4.5 8L9 4 M15 8L19.5 4 M15 20L19.5 15.5 M4.5 20L9 15.5" />
          </svg>
        </button>)}
        <button type="button" disabled={disabled} className="view-control-button home-view" aria-label={TEXT.homeIso}
          data-tooltip={TEXT.homeIso} onClick={onHome} onMouseEnter={() => setHovered(null)} onFocus={() => setHovered(null)}>
          <svg className="home-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9.2V20h13V9.2" /><path d="M9.5 20v-6h5v6" />
          </svg>
        </button>
      </div>
    </div>
  </div>;
});
ViewCube.displayName = 'ViewCube';
