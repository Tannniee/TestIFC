import * as THREE from "three";

// Engineering IFC Z-up to the viewer's Y-up coordinates (same mapping as ViewCube).
export const MEASURE_AXES = [
  { name: "X", color: 0xef4444, direction: new THREE.Vector3(1, 0, 0) },
  { name: "Y", color: 0x22c55e, direction: new THREE.Vector3(0, 0, -1) },
  { name: "Z", color: 0x3b82f6, direction: new THREE.Vector3(0, 1, 0) },
] as const;

/** Screen-distance snap to a signed axis; reject end-on axes and the origin dead zone. */
export function snapMeasurementAxis(origin: THREE.Vector3, length: number, camera: THREE.Camera,
  width: number, height: number, x: number, y: number) {
  const project = (point: THREE.Vector3) => {
    const p = point.clone().project(camera);
    return new THREE.Vector2((p.x + 1) * width / 2, (1 - p.y) * height / 2);
  };
  const start = project(origin);
  const mouse = new THREE.Vector2(x, y);
  if (mouse.distanceTo(start) < 12) return null;
  let best: { point: THREE.Vector3; distance: number; axis: string } | null = null;
  for (const axis of MEASURE_AXES) for (const sign of [-1, 1]) {
    const point = origin.clone().addScaledVector(axis.direction, length * sign);
    const delta = project(point).sub(start);
    if (delta.length() < 20) continue;
    const fraction = mouse.clone().sub(start).dot(delta) / delta.lengthSq();
    if (fraction < 0 || fraction > 1.12) continue;
    const distance = mouse.distanceTo(start.clone().addScaledVector(delta, Math.min(fraction, 1)));
    if (distance <= 10 && (!best || distance < best.distance)) best = { point, distance, axis: axis.name };
  }
  return best;
}
