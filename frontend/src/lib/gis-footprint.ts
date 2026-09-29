import type { ManualAnchor } from "./api-contracts";

/** Viewer X is IFC east/X; viewer -Z is IFC north/Y. The anchor marks the bounds center. */
export interface GisModelBounds {
  minEast: number; maxEast: number; minNorth: number; maxNorth: number;
}

const EARTH_CIRCUMFERENCE_METERS = 40075016.68557849;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function footprintCoordinates(anchor: ManualAnchor, bounds: GisModelBounds): [number, number][] | null {
  const { longitude, latitude, rotationDegrees, scale } = anchor;
  const { minEast, maxEast, minNorth, maxNorth } = bounds;
  if (![longitude, latitude, rotationDegrees, scale, minEast, maxEast, minNorth, maxNorth].every(Number.isFinite)
    || Math.abs(latitude) >= MAX_MERCATOR_LATITUDE || Math.abs(longitude) > 180 || scale <= 0
    || minEast >= maxEast || minNorth >= maxNorth) return null;
  const latitudeRadians = radians(latitude);
  const metersToMercator = 1 / (EARTH_CIRCUMFERENCE_METERS * Math.cos(latitudeRadians));
  const originX = (longitude + 180) / 360;
  const originY = (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2;
  const centerEast = (minEast + maxEast) / 2;
  const centerNorth = (minNorth + maxNorth) / 2;
  const cosine = Math.cos(radians(rotationDegrees));
  const sine = Math.sin(radians(rotationDegrees));
  const corners: [number, number][] = [
    [minEast, minNorth], [maxEast, minNorth], [maxEast, maxNorth], [minEast, maxNorth],
  ];
  const ring = corners.map(([east, north]): [number, number] => {
    const localEast = (east - centerEast) * scale;
    const localNorth = (north - centerNorth) * scale;
    const rotatedEast = localEast * cosine + localNorth * sine;
    const rotatedNorth = -localEast * sine + localNorth * cosine;
    const x = originX + rotatedEast * metersToMercator;
    const y = originY - rotatedNorth * metersToMercator;
    return [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
  });
  if (ring.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat)
    || Math.abs(lon) > 180 || Math.abs(lat) >= MAX_MERCATOR_LATITUDE)) return null;
  return [...ring, ring[0]];
}
