"""Independent original-source OCC comparison of actual packaged captures.

This private diagnostic samples surfaces; it does not claim exact Hausdorff
distance or whole-model parity. The known OCC Boolean omission at #490757 is
compared against the independently integrated section volume instead.
"""
from pathlib import Path
import ast, json, sys
import numpy as np
import ifcopenshell, ifcopenshell.geom

root = Path(__file__).resolve().parent
cohort = root / sys.argv[1]
helper = Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py')
tree = ast.parse(helper.read_text())
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)],
                       type_ignores=[]), str(helper), 'exec'))
data = json.loads((cohort / 'selected-meshes.json').read_text())
run = json.loads((cohort / 'report.json').read_text())
model = ifcopenshell.open(run['model'])
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, True)
settings.set('mesher-linear-deflection', 1e-6)
rtc = data['coordinateInfo'].get('wasmRtcOffset', {'x': 0, 'y': 0, 'z': 0})
selected = {178955, 281338, 286665, 287038, 319371, 198892, 448868, 460997, 490757}
rows = []
def limited_samples(v, t):
    values = sample(v, t)[len(v):]  # unreferenced storage vertices are not surfaces
    return values[np.linspace(0, len(values) - 1, min(512, len(values)), dtype=int)]
for mesh in data['meshes']:
    entity_id = mesh['expressId']
    if entity_id not in selected:
        continue
    p = np.asarray(mesh['positions']).reshape(-1, 3) + mesh.get('origin', [0, 0, 0])
    v = np.column_stack((p[:, 0] + rtc['x'], -p[:, 2] + rtc['y'], p[:, 1] + rtc['z']))
    t = np.asarray(mesh['indices']).reshape(-1, 3)
    actual = stats(v, t)
    row = {'id': entity_id, 'actual': actual}
    if entity_id == 490757:
        expected = 0.02417671346922483
        row.update(reference='Independent section integration; OCC misses authored cut #490787',
                   referenceVolumeM3=expected,
                   relativeVolumeErrorPercent=abs(actual['volume'] - expected) / expected * 100)
        assert abs(actual['volume'] - expected) / expected < .001, row
    else:
        shape = ifcopenshell.geom.create_shape(settings, model.by_id(entity_id))
        ov = np.asarray(shape.geometry.verts).reshape(-1, 3)
        ot = np.asarray(shape.geometry.faces).reshape(-1, 3)
        center = ov.mean(axis=0)
        a = distances(limited_samples(v, t) - center, ov - center, ot)
        b = distances(limited_samples(ov, ot) - center, v - center, t)
        expected = stats(ov, ot)
        row.update(reference='IfcOpenShell 0.8.5 OCC, 1 micrometre mesher deflection',
                   oracle=expected,
                   sampledMaxSurfaceDistanceMm=float(max(a.max(), b.max()) * 1000),
                   maxBoundsDeltaMm=float(abs(np.asarray([v[np.unique(t)].min(0), v[np.unique(t)].max(0)]) -
                                             np.asarray([ov.min(0), ov.max(0)])).max() * 1000),
                   relativeVolumeErrorPercent=abs(actual['volume'] - expected['volume']) / expected['volume'] * 100)
        if entity_id == 286665:
            assert abs(actual['volume'] - 0.09050675564233114) < 2e-6, row
        if entity_id == 178955:
            assert row['maxBoundsDeltaMm'] < .1 and row['relativeVolumeErrorPercent'] < .1, row
        # Raw surfaces may contain a double-sided film far from the oracle
        # surface. Measure its material thickness rather than silently dropping
        # it from the comparison or reporting a filtered Hausdorff bound.
        tri = v[t] - center
        centroids = tri.mean(axis=1)
        chosen = np.linspace(0, len(tri)-1, min(512, len(tri)), dtype=int)
        separation = distances(centroids[chosen], ov-center, ot)
        far = chosen[separation > .0002]
        a0 = tri[:, 0]; ab = tri[:, 1] - a0; ac = tri[:, 2] - a0
        widths = []
        for face in far:
            normal = np.cross(ab[face], ac[face])
            normal /= np.linalg.norm(normal)
            h = np.cross(np.broadcast_to(normal, ac.shape), ac)
            determinant = np.einsum('ij,ij->i', ab, h)
            valid = abs(determinant) > 1e-20
            inv = np.divide(1., determinant, out=np.zeros_like(determinant), where=valid)
            delta = centroids[face] - a0
            u = inv * np.einsum('ij,ij->i', delta, h)
            q = np.cross(delta, ab)
            w = inv * (q @ normal)
            hit = inv * np.einsum('ij,ij->i', ac, q)
            valid &= (u >= -1e-9) & (w >= -1e-9) & (u+w <= 1+1e-9) & (abs(hit) > 1e-10)
            valid[face] = False
            inward = abs(hit[valid])
            widths.append(float(inward.min()) if len(inward) else None)
        row.update(farCentroidSamples=len(far),
                   farSurfaceNearestOppositeHitMm=[None if x is None else x*1000 for x in widths])
    rows.append(row)
    print(json.dumps(row), flush=True)
assert {r['id'] for r in rows} == selected
(cohort / 'oracle-qualified.json').write_text(json.dumps({
    'ifcopenshellVersion': ifcopenshell.version, 'exeSha256': run['exeSha256'],
    'modelSha256': run['modelSha256'],
    'method': 'At most 512 deterministic samples per direction; not exact Hausdorff or whole-model parity',
    'rows': rows}, indent=2))
