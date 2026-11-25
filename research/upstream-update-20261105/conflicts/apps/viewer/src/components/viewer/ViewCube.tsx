/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
<<<<<<< custom-r7
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { CameraViewpoint } from '@/store/types';
import { cubeOrientation, namedCubeView } from './viewcube-camera';
import {
  VIEW_CUBE_SURFACES, VIEW_CUBE_QUICK_VIEWS, VIEW_CUBE_DRAG_THRESHOLD,
  currentDirectionKey, directionKey, faceLabelTransform, orientationTransform,
  surfaceClass, surfaceName, viewNames, type ViewCubeText, type ViewDirection,
} from './viewcube-math';
||||||| previous-upstream

import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { VIEW_CUBE_SIZE_PX } from './viewcube-box';
=======

import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import { VIEW_CUBE_EDGE_BAND_PX, VIEW_CUBE_SIZE_PX } from './viewcube-box';
import {
  CUBE_FACES,
  faceOfDirection,
  facesOfDirection,
  isZoneHighlighted,
  zonesForFace,
  type CubeDirection,
  type CubeFace,
  type CubeZone,
} from './viewcube-zones';
>>>>>>> github-main

interface ViewCubeProps {
  onViewChange?: (view: string) => void;
<<<<<<< custom-r7
  onDirection?: (direction: ViewDirection) => void;
  onHome?: () => void;
||||||| previous-upstream
=======
  /** An edge or corner was clicked: camera offset in the preset face frame. */
  onDirectionChange?: (direction: CubeDirection) => void;
>>>>>>> github-main
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
<<<<<<< custom-r7
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
||||||| previous-upstream

const FACES = [
  { id: 'front', label: 'FRONT', transform: (h: number) => `translateZ(${h}px)` },
  { id: 'back', label: 'BACK', transform: (h: number) => `translateZ(${-h}px) rotateY(180deg)` },
  { id: 'top', label: 'TOP', transform: (h: number) => `translateY(${-h}px) rotateX(90deg)` },
  { id: 'bottom', label: 'BTM', transform: (h: number) => `translateY(${h}px) rotateX(-90deg)` },
  { id: 'right', label: 'RIGHT', transform: (h: number) => `translateX(${h}px) rotateY(90deg)` },
  { id: 'left', label: 'LEFT', transform: (h: number) => `translateX(${-h}px) rotateY(-90deg)` },
];

export const ViewCube = forwardRef<ViewCubeRef, ViewCubeProps>(
  ({ onViewChange, onDrag, rotationX = -25, rotationY = 45 }, ref) => {
    const [hovered, setHovered] = useState<string | null>(null);
    const [isMouseDown, setIsMouseDown] = useState(false);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const didDragRef = useRef(false);
    const isDraggingRef = useRef(false);
    const onDragRef = useRef(onDrag);
    const rotationContainerRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number | null>(null);
    const pendingRotationRef = useRef<{ x: number; y: number } | null>(null);

    // Keep onDrag ref up to date
    useEffect(() => {
      onDragRef.current = onDrag;
    }, [onDrag]);

    // Expose updateRotation method via ref for direct updates (no React re-renders)
    useImperativeHandle(ref, () => ({
      updateRotation: (x: number, y: number) => {
        if (!rotationContainerRef.current) return;

        // Store pending rotation
        pendingRotationRef.current = { x, y };

        // Cancel any pending animation frame
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
        }

        // Batch updates via requestAnimationFrame for smooth 60fps
        rafRef.current = requestAnimationFrame(() => {
          if (rotationContainerRef.current && pendingRotationRef.current) {
            rotationContainerRef.current.style.transform = `rotateX(${pendingRotationRef.current.x}deg) rotateY(${pendingRotationRef.current.y}deg)`;
            pendingRotationRef.current = null;
          }
          rafRef.current = null;
        });
      },
    }), []);

    // Initial rotation from props (only on mount)
    useEffect(() => {
      if (rotationContainerRef.current) {
        rotationContainerRef.current.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
      }
    }, []); // Empty deps - only set initial rotation

    const size = VIEW_CUBE_SIZE_PX;
    const half = size / 2;

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      // Track mouse position for potential drag
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      didDragRef.current = false;
      isDraggingRef.current = false;
      setIsMouseDown(true);
    }, []);

    // Document-level mouse handlers
    useEffect(() => {
      if (!isMouseDown) {
        document.body.style.cursor = '';
        return;
=======

const FACES: { id: CubeFace; label: string; transform: (h: number) => string }[] = [
  { id: 'front', label: 'FRONT', transform: (h) => `translateZ(${h}px)` },
  { id: 'back', label: 'BACK', transform: (h) => `translateZ(${-h}px) rotateY(180deg)` },
  { id: 'top', label: 'TOP', transform: (h) => `translateY(${-h}px) rotateX(90deg)` },
  { id: 'bottom', label: 'BTM', transform: (h) => `translateY(${h}px) rotateX(-90deg)` },
  { id: 'right', label: 'RIGHT', transform: (h) => `translateX(${h}px) rotateY(90deg)` },
  { id: 'left', label: 'LEFT', transform: (h) => `translateX(${-h}px) rotateY(-90deg)` },
];

const ZONES_BY_FACE = Object.fromEntries(CUBE_FACES.map((f) => [f, zonesForFace(f)])) as Record<CubeFace, CubeZone[]>;

// Lines between cells: hairlines that stay invisible until the pointer is over
// the cube, then fade in very faintly. Each face draws its own outline on the
// grid, so an idle cube is as clean as a plain one.
const SEPARATORS = [
  'group-hover/cube:border-l-foreground/[0.045]',
  'group-hover/cube:border-r-foreground/[0.045]',
  'group-hover/cube:border-t-foreground/[0.045]',
  'group-hover/cube:border-b-foreground/[0.045]',
];

const cubeTransform = (x: number, y: number) => `rotateX(${x}deg) rotateY(${y}deg)`;

export const ViewCube = forwardRef<ViewCubeRef, ViewCubeProps>(
  ({ onViewChange, onDirectionChange, onDrag, rotationX = -25, rotationY = 45 }, ref) => {
    const { t } = useTranslation();
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [isMouseDown, setIsMouseDown] = useState(false);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const didDragRef = useRef(false);
    const isDraggingRef = useRef(false);
    const onDragRef = useRef(onDrag);
    const rotationContainerRef = useRef<HTMLDivElement>(null);

    // Keep onDrag ref up to date
    useEffect(() => {
      onDragRef.current = onDrag;
    }, [onDrag]);

    // Expose updateRotation for direct updates (no React re-renders). Applied
    // synchronously: the caller already runs once per camera change (pointer
    // move or animation-loop tick), and deferring to another animation frame
    // is what made the cube trail the model by a frame while orbiting.
    useImperativeHandle(ref, () => ({
      updateRotation: (x: number, y: number) => {
        if (rotationContainerRef.current) {
          rotationContainerRef.current.style.transform = cubeTransform(x, y);
        }
      },
    }), []);

    // Initial rotation from props (only on mount)
    useEffect(() => {
      if (rotationContainerRef.current) {
        rotationContainerRef.current.style.transform = cubeTransform(rotationX, rotationY);
      }
    }, []); // Empty deps - only set initial rotation

    const size = VIEW_CUBE_SIZE_PX;
    const half = size / 2;

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      // Track mouse position for potential drag
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      didDragRef.current = false;
      isDraggingRef.current = false;
      setIsMouseDown(true);
    }, []);

    // Document-level mouse handlers
    useEffect(() => {
      if (!isMouseDown) {
        document.body.style.cursor = '';
        return;
>>>>>>> github-main
      }
<<<<<<< custom-r7
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
    <fieldset className={`view-nav-cluster${disabled ? ' disabled' : ''}`} aria-label={TEXT.viewCube}>
      <fieldset className="view-cube__panel" aria-label={TEXT.directions}><div className="view-cube">
        <div className={`view-cube__stage${dragging ? ' is-dragging' : ''}`} onPointerDown={down}>
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
||||||| previous-upstream

      const handleDocumentMouseMove = (e: MouseEvent) => {
        if (!dragStartRef.current) return;

        const deltaX = e.clientX - dragStartRef.current.x;
        const deltaY = e.clientY - dragStartRef.current.y;

        // Start dragging after threshold (distinguishes from clicks)
        if (!isDraggingRef.current && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
          isDraggingRef.current = true;
          didDragRef.current = true;
          document.body.style.cursor = 'grabbing';
        }

        if (isDraggingRef.current) {
          onDragRef.current?.(deltaX * 2, deltaY * 2);
          dragStartRef.current = { x: e.clientX, y: e.clientY };
        }
      };

      const handleDocumentMouseUp = () => {
        setIsMouseDown(false);
        isDraggingRef.current = false;
        dragStartRef.current = null;
        document.body.style.cursor = '';
        // Reset didDragRef after a brief delay to allow click to check it
        setTimeout(() => {
          didDragRef.current = false;
        }, 50);
      };

      document.addEventListener('mousemove', handleDocumentMouseMove);
      document.addEventListener('mouseup', handleDocumentMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
        document.body.style.cursor = '';
      };
    }, [isMouseDown]);

    const handleFaceClick = useCallback((face: string) => {
      // Only trigger click if we didn't drag
      if (!didDragRef.current) {
        onViewChange?.(face);
      }
    }, [onViewChange]);

    return (
      // Mouse dragging changes the cube orientation; the child face buttons provide keyboard views.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        className="relative select-none"
        style={{
          width: size,
          height: size,
          perspective: 200,
        }}
        onMouseDown={handleMouseDown}
      >
        <div
          ref={rotationContainerRef}
          className="relative w-full h-full"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`,
          }}
        >
          {FACES.map(({ id, label, transform }) => (
            <button
              key={id}
              type="button"
              className={cn(
                'absolute w-full h-full flex items-center justify-center text-2xs font-bold transition-colors cursor-pointer',
                'bg-card/95 border border-border/50',
                hovered === id ? 'bg-primary/30 border-primary text-primary' : 'hover:bg-muted'
              )}
              style={{
                transform: transform(half),
                backfaceVisibility: 'hidden',
              }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => handleFaceClick(id)}
            >
              {label}
            </button>
          ))}
=======

      const handleDocumentMouseMove = (e: MouseEvent) => {
        if (!dragStartRef.current) return;

        const deltaX = e.clientX - dragStartRef.current.x;
        const deltaY = e.clientY - dragStartRef.current.y;

        // Start dragging after threshold (distinguishes from clicks)
        if (!isDraggingRef.current && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
          isDraggingRef.current = true;
          didDragRef.current = true;
          document.body.style.cursor = 'grabbing';
        }

        if (isDraggingRef.current) {
          onDragRef.current?.(deltaX * 2, deltaY * 2);
          dragStartRef.current = { x: e.clientX, y: e.clientY };
        }
      };

      const handleDocumentMouseUp = () => {
        setIsMouseDown(false);
        isDraggingRef.current = false;
        dragStartRef.current = null;
        document.body.style.cursor = '';
        // Reset didDragRef after a brief delay to allow click to check it
        setTimeout(() => {
          didDragRef.current = false;
        }, 50);
      };

      document.addEventListener('mousemove', handleDocumentMouseMove);
      document.addEventListener('mouseup', handleDocumentMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
        document.body.style.cursor = '';
      };
    }, [isMouseDown]);

    const handleZoneClick = useCallback((zone: CubeZone) => {
      // Only trigger click if we didn't drag
      if (didDragRef.current) return;
      const face = faceOfDirection(zone.direction);
      if (face) onViewChange?.(face);
      else onDirectionChange?.(zone.direction);
    }, [onViewChange, onDirectionChange]);

    return (
      // Mouse dragging changes the cube orientation; the child face buttons provide keyboard views.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        className="group/cube relative select-none drop-shadow-md"
        style={{
          width: size,
          height: size,
          perspective: 200,
        }}
        onMouseDown={handleMouseDown}
      >
        <div
          ref={rotationContainerRef}
          className="relative w-full h-full"
          style={{
            transformStyle: 'preserve-3d',
            transform: cubeTransform(rotationX, rotationY),
          }}
        >
          {FACES.map(({ id, label, transform }) => (
            <div
              key={id}
              className="absolute w-full h-full grid border border-foreground/30"
              style={{
                transform: transform(half),
                backfaceVisibility: 'hidden',
                gridTemplate: `${VIEW_CUBE_EDGE_BAND_PX}px 1fr ${VIEW_CUBE_EDGE_BAND_PX}px / ${VIEW_CUBE_EDGE_BAND_PX}px 1fr ${VIEW_CUBE_EDGE_BAND_PX}px`,
              }}
            >
              {ZONES_BY_FACE[id].map((zone) => {
                const lit = isZoneHighlighted(zone, id, hoveredKey);
                const isFace = zone.kind === 'face';
                return (
                  <button
                    key={zone.key}
                    type="button"
                    aria-label={t('viewportLighting.viewCube.zoneAria', {
                      faces: facesOfDirection(zone.direction)
                        .map((f) => t(`viewportLighting.viewCube.face.${f}`))
                        .join(' / '),
                    })}
                    data-viewcube-zone={zone.kind}
                    // The face button's box spans the whole face; the edge and corner pieces sit on
                    // top and take the clicks in the outer band, so only the middle of the face
                    // selects the face view.
                    style={isFace
                      ? { gridArea: '1 / 1 / -1 / -1' }
                      : { gridColumn: zone.col + 2, gridRow: zone.row + 2, zIndex: 1 }}
                    // Keyboard users get the six face views (as before) plus the view shortcuts;
                    // 20 more stops, many of them facing away, would bloat the tab order.
                    tabIndex={isFace ? undefined : -1}
                    className={cn(
                      'flex items-center justify-center text-2xs font-bold cursor-pointer border text-foreground/70',
                      'transition-[background-color,border-color,color] duration-150 ease-out',
                      // Every cell shares the face fill (white / black by theme), solid so nothing
                      // bleeds through from the viewport behind. The hovered piece (and its twins on
                      // the neighbouring faces) gets a clear outline of its own.
                      'border-transparent',
                      ...SEPARATORS,
                      lit
                        ? 'bg-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-card))] text-foreground active:bg-[color-mix(in_srgb,var(--color-primary)_70%,var(--color-card))]'
                        : 'bg-card',
                      zone.key === hoveredKey && '!border-primary/80',
                    )}
                    onMouseEnter={() => setHoveredKey(zone.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                    onClick={() => handleZoneClick(zone)}
                  >
                    {isFace ? label : null}
                  </button>
                );
              })}
            </div>
          ))}
>>>>>>> github-main
        </div>
      </div></fieldset>
      <fieldset className="view-controls" aria-label={TEXT.quickViews}>
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
      </fieldset>
    </fieldset>
  </div>;
});
ViewCube.displayName = 'ViewCube';
