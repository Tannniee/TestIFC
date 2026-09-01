import type { MeasurementResult, Vector3Value } from "./viewer-contracts";

export function isFullyIncludedSweep(startX: number, endX: number): boolean {
  return endX >= startX;
}

export function formatMeasurement(distanceInMeters: number): string {
  if (!Number.isFinite(distanceInMeters)) return "—";
  if (Math.abs(distanceInMeters) < 0.01) return `${(distanceInMeters * 1000).toFixed(1)} mm`;
  if (Math.abs(distanceInMeters) < 1) return `${(distanceInMeters * 100).toFixed(2)} cm`;
  return `${distanceInMeters.toFixed(3)} m`;
}

export function measurementMidpoint(measurement: MeasurementResult): Vector3Value {
  return {
    x: (measurement.start.x + measurement.end.x) * 0.5,
    y: (measurement.start.y + measurement.end.y) * 0.5,
    z: (measurement.start.z + measurement.end.z) * 0.5,
  };
}

export type MeasurementUnit = "mm" | "m";

export function measurementInputToMeters(value: number, unit: MeasurementUnit): number {
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  return unit === "mm" ? value / 1000 : value;
}

export function pointAtDistance(start: Vector3Value, end: Vector3Value, distance: number): Vector3Value | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(distance) || distance <= 0 || length <= Number.EPSILON) return null;
  const scale = distance / length;
  return { x: start.x + dx * scale, y: start.y + dy * scale, z: start.z + dz * scale };
}
