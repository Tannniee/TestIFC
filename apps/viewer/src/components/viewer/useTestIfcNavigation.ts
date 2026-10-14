/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useRef, type RefObject } from 'react';
import type { Renderer } from '@ifc-lite/renderer';
import { useViewerStore } from '@/store';

/** Uses the native renderer's camera and canonical placed selection bounds. */
export function useTestIfcNavigation(rendererRef: RefObject<Renderer | null>, initialized: boolean) {
  const preset = useViewerStore(s => s.navigationPreset);
  const mode = useViewerStore(s => s.testIfcOrbitMode);
  const tool = useViewerStore(s => s.activeTool);
  const selected = useViewerStore(s => s.selectedEntityId);
  const modelId = useViewerStore(s => s.activeModelId);
  const lastModelPivot = useRef<string | null>(null);
  const configuredRenderer = useRef<Renderer | null>(null);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!initialized || !renderer) return;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-viewport="main"]');
    if (!canvas) return;
    if (configuredRenderer.current !== renderer) {
      renderer.getCamera().setProjectionMode(useViewerStore.getState().projectionMode);
      configuredRenderer.current = renderer;
    }
    const update = () => renderer.getCamera().configureNavigation(preset === 'testifc' ? 'testifc' : 'ifclite', canvas.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [rendererRef, initialized, preset]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!initialized || !renderer || preset !== 'testifc' || tool !== 'select') return;
    const camera = renderer.getCamera();
    camera.setOrbitCenter(null);
    if (mode === 'selection') {
      lastModelPivot.current = null;
      const bounds = useViewerStore.getState().cameraCallbacks.selectionBounds?.();
      if (bounds) {
        const point = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
        void camera.framePoint(point, 340).catch(error => console.error('[TestIFC] orbit center failed', error));
      }
    } else if (mode === 'model') {
      const key = modelId ?? 'empty';
      if (lastModelPivot.current === key) return;
      const bounds = camera.getOrbitAnchorBounds() ?? camera.getSceneBounds();
      if (bounds) {
        lastModelPivot.current = key;
        void camera.framePoint({ x: (bounds.min.x + bounds.max.x) / 2,
          y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 }, 340)
          .catch(error => console.error('[TestIFC] model center failed', error));
      }
    } else lastModelPivot.current = null;
    renderer.requestRender();
  }, [rendererRef, initialized, preset, mode, selected, modelId, tool]);
}
