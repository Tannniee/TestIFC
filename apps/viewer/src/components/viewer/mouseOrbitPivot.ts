/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Renderer, Camera } from '@ifc-lite/renderer';
import type { MeshData } from '@ifc-lite/geometry';
import { useViewerStore } from '@/store';
import { getEntityCenter } from '../../utils/viewportUtils.js';
import { isPivotRaycastTooExpensive } from './orbitPivotCensus.js';
import { focusedClashOrbitPivot, sceneAnchorOrbitPivot } from './orbitPivot.js';

export function mouseOrbitPivot(renderer: Renderer, camera: Camera, canvas: HTMLCanvasElement,
  event: PointerEvent, geometry: MeshData[] | null, selectedId: number | null, hiddenIds: Set<number>, isolatedIds: Set<number> | null) {
  const state = useViewerStore.getState();
  // TestIFC retains camera.target across drags; only an explicit tool/selection
  // transition moves that target. Native IFC axes are unchanged.
  if (state.navigationPreset === 'testifc') return null;
  const clash = focusedClashOrbitPivot(state, selectedId);
  if (clash) return clash;
  const rect = canvas.getBoundingClientRect();
  const cx = event.clientX - rect.left, cy = event.clientY - rect.top;
  // Preserve the native large/sparse-scene path: do not build a costly BVH
  // at orbit start when a robust scene anchor is already available.
  if (!isPivotRaycastTooExpensive(renderer.getScene()) && camera.getOrbitAnchorBounds() === null) {
    const hit = renderer.raycastScene(cx, cy, { hiddenIds, isolatedIds });
    if (hit?.intersection) return hit.intersection.point;
  }
  if (selectedId) return getEntityCenter(geometry, selectedId);
  return sceneAnchorOrbitPivot(camera, cx, cy, rect.width, rect.height);
}
