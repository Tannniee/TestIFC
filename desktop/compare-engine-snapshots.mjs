/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// Small-fixture qualification of actual packaged WASM/native snapshots. The
// quadratic point matching deliberately favors transparent geometry evidence
// over throughput; do not use this script as a large-model performance test.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const reports = join(dirname(fileURLToPath(import.meta.url)), 'reports');
const wasm = JSON.parse(await readFile(join(reports, 'engine-wasm-baseline.json'), 'utf8'));
const native = JSON.parse(await readFile(join(reports, 'engine-native-preview.json'), 'utf8'));
const tolerance = 0.00001; // 0.01 mm, in absolute Y-up world coordinates.
const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const groups = snapshot => {
  const map = new Map();
  for (const mesh of snapshot.meshes) {
    const group = map.get(mesh.expressId) ?? [];
    group.push(mesh); map.set(mesh.expressId, group);
  }
  return map;
};
const a = groups(wasm), b = groups(native);
assert.deepEqual([...a.keys()].sort((x, y) => x - y), [...b.keys()].sort((x, y) => x - y));
const entities = [];
for (const [id, expected] of a) {
  const actual = b.get(id);
  assert.equal(actual.length, expected.length, `#${id} mesh count`);
  const points = [];
  const nearest = point => {
    let index = -1, delta = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = distance(point, points[i]);
      if (d < delta) { index = i; delta = d; }
    }
    return { index, delta };
  };
  for (const mesh of expected) for (const p of mesh.vertices) {
    if (nearest(p).delta > tolerance) points.push(p);
  }
  let maxVertexDelta = 0;
  const triangleKeys = meshes => {
    const keys = [];
    for (const mesh of meshes) {
      const vertices = mesh.vertices.map(p => {
        const match = nearest(p);
        assert.ok(match.delta <= tolerance, `#${id} unexpected world point: ${p}`);
        maxVertexDelta = Math.max(maxVertexDelta, match.delta);
        return match.index;
      });
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const tri = mesh.indices.slice(i, i + 3).map(v => vertices[v]);
        assert.ok(tri.length === 3 && tri.every(Number.isInteger), `#${id} triangle indices`);
        // Cyclic permutations are equivalent, reversed winding is not.
        keys.push([tri.join(':'), [tri[1], tri[2], tri[0]].join(':'),
          [tri[2], tri[0], tri[1]].join(':')].sort()[0]);
      }
    }
    return keys.sort();
  };
  assert.deepEqual(triangleKeys(actual), triangleKeys(expected), `#${id} triangle surfaces/winding`);
  const actualPoints = actual.flatMap(m => m.vertices);
  for (const p of points) assert.ok(actualPoints.some(v => distance(p, v) <= tolerance), `#${id} missing world point`);
  for (const m of expected) assert.ok(actual.some(n => n.geometryClass === m.geometryClass
    && distance(n.color, m.color) < 0.000001), `#${id} material color and geometry class`);
  entities.push({ id, maxVertexDelta, uniqueWorldPoints: points.length,
    triangles: actual.reduce((sum, m) => sum + m.indices.length / 3, 0) });
}
const result = { passed: true, source: wasm.source, toleranceMeters: tolerance,
  meshCounts: [wasm.meshes.length, native.meshes.length],
  maximumVertexDelta: Math.max(...entities.map(e => e.maxVertexDelta)),
  evidence: 'bidirectional absolute world vertices, triangle surfaces with winding, colors and geometry classes', entities };
await writeFile(join(reports, 'engine-parity-summary.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
