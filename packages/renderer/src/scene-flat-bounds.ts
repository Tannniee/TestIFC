// SPDX-License-Identifier: MPL-2.0
import type { MeshData } from '@ifc-lite/geometry';

export function flatMeshDataBounds(meshes: ReadonlyMap<number, readonly MeshData[]>): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
    if (meshes.size === 0) return null;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasValidData = false;

    // Compute bounds from all mesh data
    for (const pieces of meshes.values()) {
      for (const piece of pieces) {
        const positions = piece.positions;
        // world = origin + position (per-element local frame).
        const ox = piece.origin ? piece.origin[0] : 0;
        const oy = piece.origin ? piece.origin[1] : 0;
        const oz = piece.origin ? piece.origin[2] : 0;
        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i] + ox;
          const y = positions[i + 1] + oy;
          const z = positions[i + 2] + oz;
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            hasValidData = true;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
        }
      }
    }

    if (!hasValidData) return null;

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
}
