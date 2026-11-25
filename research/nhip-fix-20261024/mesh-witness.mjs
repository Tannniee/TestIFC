import assert from 'node:assert/strict';

// Exact stored-coordinate boundary, independent of triangle density. A finer
// curve may change triangle counts while preserving the required solid.
export function assertClosedMesh(mesh) {
  const {positions, indices} = mesh;
  assert.ok(indices.length > 0);
  assert.equal(indices.length % 3, 0);
  const point = index => {
    assert.ok(Number.isInteger(index) && index >= 0 && index * 3 + 2 < positions.length);
    const p = positions.slice(index * 3, index * 3 + 3);
    assert.ok(p.every(Number.isFinite));
    return p;
  };
  const edges = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const p = indices.slice(i, i + 3).map(point);
    const a = p[1].map((v, j) => v - p[0][j]);
    const b = p[2].map((v, j) => v - p[0][j]);
    assert.ok(a[1] * b[2] - a[2] * b[1] !== 0 || a[2] * b[0] - a[0] * b[2] !== 0 || a[0] * b[1] - a[1] * b[0] !== 0);
    const keys = p.map(p => p.join(','));
    for (let j = 0; j < 3; j++) {
      const [a, b] = [keys[j], keys[(j + 1) % 3]];
      const forward = a < b;
      const key = JSON.stringify(forward ? [a, b] : [b, a]);
      const value = edges.get(key) || [0, 0];
      value[0]++; value[1] += forward ? 1 : -1; edges.set(key, value);
    }
  }
  assert.ok([...edges.values()].every(([count, balance]) => count === 2 && balance === 0), 'finite material boundary must be closed');
}
