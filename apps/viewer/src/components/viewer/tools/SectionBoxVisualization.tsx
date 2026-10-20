/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViewerStore } from '@/store';
import type { SectionBox, SectionBoxFace } from '@/store/types';
import { useTranslation } from '@/i18n';
import { capturePointer, releasePointer } from '@/lib/pointer-capture';
import { SECTION_BOX_FACES, faceSide, sectionBoxFaceCenter, sectionBoxFaceCorners, sectionBoxFaceNormal, type Vec3Tuple } from '@/lib/section/section-box';
import { boxDragAxis, visibleHeight } from '@/lib/section/testifc-box-math';
import { applyEditedBox, useTestIfcBoxUi } from '@/lib/section/testifc-box-controller';
import { captureBoxScope, isCurrentBoxScope } from '@/lib/section/testifc-box-scope';
import { PlaneOutline, useSceneProjector, useSceneLayer, useWorldAnchor } from '../../viewport-ui/scene';
import type { ScreenPoint, Vec3 } from '../../viewport-ui/scene/types';

const vec = (p: Vec3Tuple): Vec3 => ({ x: p[0], y: p[1], z: p[2] });
interface FaceScreen { foot: ScreenPoint | null; tip: ScreenPoint | null }
interface Drag {
  face: SectionBoxFace; box: SectionBox; pointerId: number; element: HTMLButtonElement;
  cursor: ScreenPoint; axis: ReturnType<typeof boxDragAxis>; stride: number;
  scope: ReturnType<typeof captureBoxScope>;
}

export function SectionBoxVisualization() {
  const box = useViewerStore(s => s.sectionPlane.box);
  const phase = useTestIfcBoxUi(s => s.phase);
  return box && phase === 'idle' ? <SectionBoxGizmo box={box} /> : null;
}

function SectionBoxGizmo({ box }: { box: SectionBox }) {
  const { t } = useTranslation();
  const ui = useTestIfcBoxUi();
  const projector = useSceneProjector();
  const id = useId();
  const latest = useRef(box);
  latest.current = box;
  const screen = useRef(new Map<SectionBoxFace, FaceScreen>());
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<SectionBoxFace | null>(null);
  useEffect(() => {
    if (!projector) return;
    // Presets, roll and orthographic zoom can start while the projector is idle.
    // Reuse the native camera feed; no second animation loop or React frame renders.
    return useViewerStore.getState().subscribeCameraRotation(() => projector.notifyAnchorsChanged());
  }, [projector]);
  useEffect(() => {
    if (!projector) return;
    const unregister = SECTION_BOX_FACES.flatMap(face => {
      const record: FaceScreen = { foot: null, tip: null };
      screen.current.set(face, record);
      return [
        projector.registerAnchor(`${id}-${face}-foot`, () => vec(sectionBoxFaceCenter(latest.current, face)), p => { record.foot = p.behindCamera ? null : p.screen; }),
        projector.registerAnchor(`${id}-${face}-tip`, () => {
          const c = sectionBoxFaceCenter(latest.current, face), n = sectionBoxFaceNormal(face);
          return { x: c[0] + n[0], y: c[1] + n[1], z: c[2] + n[2] };
        }, p => { record.tip = p.behindCamera ? null : p.screen; }),
      ];
    });
    return () => unregister.forEach(un => un());
  }, [projector, id]);

  const finish = (restore: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const s = useViewerStore.getState();
    if (restore && s.sectionPlane.box && isCurrentBoxScope(d.scope)) applyEditedBox(d.box);
    releasePointer(d.element, d.pointerId);
    s.setPointCloudPreviewStride(d.stride);
    s.cameraCallbacks.setInteractionMode?.(s.interactionMode);
    setDragging(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const d = drag.current;
      if (!d || event.pointerId !== d.pointerId) return;
      if (!isCurrentBoxScope(d.scope)) { finishRef.current(false); return; }
      event.preventDefault();
      const { corner, axis } = faceSide(d.face);
      const along = (event.clientX - d.cursor.x) * d.axis.x + (event.clientY - d.cursor.y) * d.axis.y;
      useViewerStore.getState().setSectionBoxFace(d.face, d.box[corner][axis] + along * d.axis.metersPerPixel);
    };
    const up = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointerId) finishRef.current(false); };
    const cancel = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointerId) finishRef.current(true); };
    const blur = () => finishRef.current(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopImmediatePropagation(); finishRef.current(true); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key, true); finishRef.current(true);
    };
  }, []);
  const down = (face: SectionBoxFace, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || drag.current) return;
    const points = screen.current.get(face);
    if (!points?.foot || !points.tip) return;
    event.preventDefault(); event.stopPropagation();
    const s = useViewerStore.getState(), pose = s.cameraCallbacks.getViewpoint?.();
    const span = pose ? visibleHeight(pose) : Math.max(...box.max.map((v, i) => v - box.min[i]));
    const height = event.currentTarget.closest('[data-scene-overlay-root]')?.clientHeight || 600;
    const axis = boxDragAxis(face, points.foot, points.tip, span, height);
    if (pose) s.cameraCallbacks.applyViewpoint?.(pose, false);
    s.cameraCallbacks.setInteractionMode?.('none');
    drag.current = { face, box: structuredClone(box), pointerId: event.pointerId, element: event.currentTarget,
      cursor: { x: event.clientX, y: event.clientY }, axis, stride: s.pointCloudPreviewStride, scope: captureBoxScope() };
    capturePointer(event.currentTarget, event.pointerId);
    setDragging(face);
    if (s.pointCloudAssetCount > 0) s.setPointCloudPreviewStride(4);
  };
  return <>{SECTION_BOX_FACES.map(face => {
    const { corner, axis } = faceSide(face);
    const label = axis === 0 ? 'X' : axis === 1 ? 'Z' : 'Y';
    const side = axis === 2 ? corner === 'min' ? 'Max' : 'Min' : corner === 'min' ? 'Min' : 'Max';
    return <div key={face} className="contents">
      {ui.showBox && <PlaneOutline corners={sectionBoxFaceCorners(box, face).map(vec)} className="fill-none stroke-[1.5px]" allowOffscreen />}
      {ui.showHandles && <BoxFaceHandle face={face} center={vec(sectionBoxFaceCenter(box, face))} active={dragging === face}
        title={t('testIfc.box.handle', { axis: label, side })} onDown={down}
        onLostCapture={() => finish(true)} />}
    </div>;
  })}</>;
}

function BoxFaceHandle({ face, center, active, title, onDown, onLostCapture }: {
  face: SectionBoxFace; center: Vec3; active: boolean; title: string;
  onDown: (face: SectionBoxFace, event: React.PointerEvent<HTMLButtonElement>) => void;
  onLostCapture: () => void;
}) {
  const layer = useSceneLayer('dom');
  const { ref } = useWorldAnchor<HTMLDivElement>(() => center);
  if (!layer) return null;
  return createPortal(<div ref={ref} className="absolute left-0 top-0" data-scene-primitive="box-handle">
    <button type="button" data-section-face={face} aria-label={title} title={title}
      className="pointer-events-auto flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded text-lg text-overlay-accent focus-visible:outline focus-visible:outline-2"
      style={{ background: active ? 'var(--overlay-accent-soft)' : 'transparent', textShadow: '0 1px 3px #000', cursor: 'grab' }}
      onPointerDown={event => onDown(face, event)} onLostPointerCapture={onLostCapture}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const s = useViewerStore.getState(), { corner, axis } = faceSide(face);
        if (s.sectionPlane.box) s.setSectionBoxFace(face, s.sectionPlane.box[corner][axis] + (event.key === 'ArrowUp' ? .1 : -.1));
      }}>◆</button>
  </div>, layer);
}
