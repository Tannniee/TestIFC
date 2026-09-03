import * as THREE from "three";
import type { SectionBoxState } from "./viewer-contracts";

export function validSectionBox(box: SectionBoxState): boolean {
  return ["x", "y", "z"].every(axis => {
    const key = axis as "x" | "y" | "z";
    return Number.isFinite(box.min[key]) && Number.isFinite(box.max[key]) && box.min[key] < box.max[key];
  });
}

export function sectionBoxPlanes(box: SectionBoxState): THREE.Plane[] {
  if (!box.enabled || !validSectionBox(box)) return [];
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.min.y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z),
  ];
}

/** Sweep in Top View: viewer Y is elevation, IFC plan axes are viewer X/-Z. */
export function sectionBoxFromSweep(camera: THREE.Camera, model: THREE.Box3,
  rect: { left: number; top: number; width: number; height: number }, width: number, height: number): SectionBoxState {
  const point = (x: number, y: number) => new THREE.Vector3(x / width * 2 - 1, 1 - y / height * 2, 0).unproject(camera);
  const a = point(rect.left, rect.top);
  const b = point(rect.left + rect.width, rect.top + rect.height);
  const padding = Math.max(model.getSize(new THREE.Vector3()).y * .00001, .001);
  return { enabled: true,
    min: { x: Math.min(a.x, b.x), y: model.min.y - padding, z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: model.max.y + padding, z: Math.max(a.z, b.z) } };
}
