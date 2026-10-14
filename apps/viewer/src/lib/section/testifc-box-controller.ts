/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { create } from 'zustand';
import { useViewerStore } from '@/store';
import type { CameraViewpoint, SectionBox, SectionPlane } from '@/store/types';
import type { TranslationKey } from '@/i18n';
import { sectionBoxFromBounds } from './section-box';
import { boxFromSweep } from './testifc-box-math';
import { loadLastSectionMode, saveLastSectionMode, type LastSectionMode } from '@/store/slices/sectionLastMode';
import { captureBoxScope, isCurrentBoxScope } from './testifc-box-scope';

type Bounds = Parameters<typeof sectionBoxFromBounds>[0];
interface BoxUi {
  phase: 'idle' | 'preparing' | 'drawing';
  showBox: boolean;
  showHandles: boolean;
  error: TranslationKey | null;
}
/** Transient drawing/display state only. All clipping stays in sectionPlane.box. */
export const useTestIfcBoxUi = create<BoxUi>(() => ({ phase: 'idle', showBox: true, showHandles: true, error: null }));
let session: {
  model: SectionBox; plane: SectionPlane; pose: CameraViewpoint;
  scope: ReturnType<typeof captureBoxScope>;
  lastMode: LastSectionMode;
  frame: number; unsubscribe: () => void;
} | null = null;

function sameScope(draft: NonNullable<typeof session>): boolean {
  return isCurrentBoxScope(draft.scope);
}

function endSession(): NonNullable<typeof session> | null {
  const draft = session;
  session = null;
  if (draft) {
    cancelAnimationFrame(draft.frame);
    draft.unsubscribe();
    const s = useViewerStore.getState();
    s.cameraCallbacks.setInteractionMode?.(s.interactionMode);
  }
  useTestIfcBoxUi.setState({ phase: 'idle', error: null });
  return draft;
}

export function cancelBoxDraw(restore = true): void {
  const draft = endSession();
  if (!draft || !restore || !sameScope(draft)) return;
  useViewerStore.setState({ sectionPlane: draft.plane, sectionPickMode: false, sectionPickPreview: null });
  saveLastSectionMode(draft.lastMode);
  useViewerStore.getState().cameraCallbacks.applyViewpoint?.(draft.pose, false);
}

export function beginBoxDraw(bounds: Bounds): boolean {
  const s = useViewerStore.getState(), camera = s.cameraCallbacks;
  const model = sectionBoxFromBounds(bounds), pose = session?.pose ?? camera.getViewpoint?.();
  if (!model || !pose || !camera.setPresetView || !camera.applyViewpoint || !camera.unprojectToFloor) return false;
  cancelBoxDraw();
  const plane = structuredClone(useViewerStore.getState().sectionPlane);
  const lastMode = loadLastSectionMode();
  s.setSectionBox(model);
  useViewerStore.setState(state => ({ sectionPlane: { ...state.sectionPlane, enabled: false } }));
  const draft = { model, plane, pose, lastMode, scope: captureBoxScope(), frame: 0, unsubscribe: () => {} };
  session = draft;
  useTestIfcBoxUi.setState({ phase: 'preparing', error: null });
  camera.setInteractionMode?.('none');
  s.setProjectionMode('orthographic');
  camera.setPresetView('top');
  draft.unsubscribe = useViewerStore.subscribe(state => {
    if (!sameScope(draft)) cancelBoxDraw(false);
    else if (state.activeTool !== 'section') cancelBoxDraw();
    else if (!state.sectionPlane.box) { cancelBoxDraw(false); camera.applyViewpoint?.(draft.pose, false); }
  });
  const deadline = performance.now() + 5000;
  let previous = '', stable = 0;
  const settle = () => {
    if (session !== draft) return;
    const current = camera.getViewpoint?.();
    const key = JSON.stringify(current);
    stable = key === previous ? stable + 1 : 0;
    previous = key;
    const dy = current ? current.position.y - current.target.y : 0;
    const length = current ? Math.hypot(current.position.x - current.target.x, dy, current.position.z - current.target.z) : 0;
    if (stable >= 3 && length > 0 && dy / length > .9999) {
      useTestIfcBoxUi.setState({ phase: 'drawing' });
    } else if (performance.now() >= deadline) {
      cancelBoxDraw();
      useTestIfcBoxUi.setState({ error: 'testIfc.box.cameraError' });
    } else draft.frame = requestAnimationFrame(settle);
  };
  draft.frame = requestAnimationFrame(settle);
  return true;
}

/** Client coordinates match the native camera's unprojectToFloor contract. */
export function finishBoxDraw(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const draft = session;
  if (!draft || !sameScope(draft) || useTestIfcBoxUi.getState().phase !== 'drawing') return false;
  const camera = useViewerStore.getState().cameraCallbacks;
  const corners = [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]];
  const box = Math.abs(a.x - b.x) >= 6 && Math.abs(a.y - b.y) >= 6
    ? boxFromSweep(corners.map(([x, y]) => camera.unprojectToFloor?.(x, y, draft.model.min[1]) ?? null), draft.model) : null;
  if (!box) {
    useTestIfcBoxUi.setState({ error: 'testIfc.box.drawError' });
    return false;
  }
  endSession();
  useViewerStore.getState().setSectionBox(box);
  useViewerStore.getState().setSectionVisible(true);
  camera.applyViewpoint?.(draft.pose, false);
  camera.frameSectionBox?.();
  return true;
}

export function applyEditedBox(box: SectionBox): void {
  const enabled = useViewerStore.getState().sectionPlane.enabled;
  useViewerStore.getState().setSectionBox(box);
  if (!enabled) useViewerStore.setState(state => ({ sectionPlane: { ...state.sectionPlane, enabled } }));
}
