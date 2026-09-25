import * as THREE from "three";
import type { EngineV2PageSummary } from "./planner-contracts.ts";

export interface EngineV2PageBudget {
  visibleTriangles: number;
  maximumPages: number;
  estimatedGpuBytes: number;
  bytesPerExpandedTriangle: number;
  bytesPerInstance: number;
  overviewMaximumPages?: number;
  overviewMaximumTriangles?: number;
}

export const DEFAULT_ENGINE_V2_PAGE_BUDGET: EngineV2PageBudget = {
  visibleTriangles: 4_000_000,
  maximumPages: 12,
  estimatedGpuBytes: 512 * 1024 * 1024,
  bytesPerExpandedTriangle: 28,
  bytesPerInstance: 80,
  overviewMaximumPages: 96,
  overviewMaximumTriangles: 1_000_000,
};

export function selectEngineV2Pages(
  pages: EngineV2PageSummary[],
  camera: THREE.Camera,
  resident: ReadonlySet<string>,
  budget: EngineV2PageBudget = DEFAULT_ENGINE_V2_PAGE_BUDGET,
): string[] {
  camera.updateMatrixWorld();
  const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const center = new THREE.Vector3();
  const box = new THREE.Box3();
  const visible = pages
    .filter(page => {
      box.min.fromArray(page.bounds, 0); box.max.fromArray(page.bounds, 3);
      return frustum.intersectsBox(box);
    })
    .map(page => {
      box.min.fromArray(page.bounds, 0); box.max.fromArray(page.bounds, 3); box.getCenter(center);
      const distance = center.distanceToSquared(cameraPosition);
      return { page, score: distance * (resident.has(page.id) ? 0.92 : 1) };
    })
    .sort((left, right) => left.score - right.score);

  const overviewTriangles = visible.reduce((sum, value) => sum + value.page.triangles, 0);
  const overviewBytes = visible.reduce((sum, value) => sum +
    value.page.triangles * budget.bytesPerExpandedTriangle + value.page.instances * budget.bytesPerInstance, 0);
  const pageLimit = budget.overviewMaximumPages && budget.overviewMaximumTriangles &&
    overviewTriangles <= budget.overviewMaximumTriangles && overviewBytes <= budget.estimatedGpuBytes
    ? Math.max(budget.maximumPages, budget.overviewMaximumPages)
    : budget.maximumPages;

  const selected: string[] = [];
  let triangles = 0;
  let estimatedBytes = 0;
  for (const { page } of visible) {
    if (selected.length >= pageLimit) break;
    const pageBytes = page.triangles * budget.bytesPerExpandedTriangle + page.instances * budget.bytesPerInstance;
    const exceeds = triangles + page.triangles > budget.visibleTriangles || estimatedBytes + pageBytes > budget.estimatedGpuBytes;
    if (selected.length && exceeds) continue;
    selected.push(page.id);
    triangles += page.triangles;
    estimatedBytes += pageBytes;
  }
  return selected;
}
