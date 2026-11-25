from pathlib import Path
import ast, json, sys, numpy as np

root = Path(__file__).resolve().parent
cohort = root / (sys.argv[1] if len(sys.argv) > 1 else 'packaged-original')
research = Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024')
helpers = ast.parse((research / 'compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n, ast.FunctionDef)],
                       type_ignores=[]), '<geometry-helpers>', 'exec'))
data = json.loads((cohort / 'selected-meshes.json').read_text())
oracle = {r['id']: r for r in json.loads((research / 'oracle-reference-and-body-hosts.json').read_text())['rows']
          if 'vertices' in r}
import ifcopenshell, ifcopenshell.geom
model_path = json.loads((cohort / 'report.json').read_text())['model']
if Path(model_path).resolve() != Path(r'F:\Working\IFC Temp\Nhip chinh.ifc').resolve():
    oracle = {}
missing = sorted({m['expressId'] for m in data['meshes']} - oracle.keys())
if missing:
    model = ifcopenshell.open(model_path)
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    for entity_id in missing:
        shape = ifcopenshell.geom.create_shape(settings, model.by_id(entity_id))
        vertices = np.asarray(shape.geometry.verts).reshape(-1, 3)
        triangles = np.asarray(shape.geometry.faces).reshape(-1, 3)
        oracle[entity_id] = {'vertices': vertices.tolist(), 'indices': triangles.tolist(),
                            'bounds': [vertices.min(0).tolist(), vertices.max(0).tolist()]}
rtc = data['coordinateInfo'].get('wasmRtcOffset', {'x': 0, 'y': 0, 'z': 0})
results = []
for mesh in data['meshes']:
    i = mesh['expressId']
    if i not in oracle:
        continue
    p = np.asarray(mesh['positions']).reshape(-1, 3) + mesh.get('origin', [0, 0, 0])
    # Native packets restore the site basis before the sole Z-up -> Y-up conversion.
    # The RTC metadata remains IFC Z-up; reverse the display axes exactly once.
    v = np.column_stack((p[:, 0] + rtc['x'], -p[:, 2] + rtc['y'], p[:, 1] + rtc['z']))
    t = np.asarray(mesh['indices']).reshape(-1, 3)
    o = oracle[i]
    ov, ot = np.asarray(o['vertices']), np.asarray(o['indices'])
    center = ov.mean(axis=0)
    a = distances(sample(v, t) - center, ov - center, ot)
    b = distances(sample(ov, ot) - center, v - center, t)
    actual, expected = stats(v, t), stats(ov, ot)
    row = {'id': i, 'native': actual, 'oracle': expected,
           'sampledMaxSurfaceDistanceMm': float(max(a.max(), b.max()) * 1000),
           'maxBoundsDeltaMm': float(abs(np.asarray([v.min(0), v.max(0)]) - np.asarray(o['bounds'])).max() * 1000),
           'relativeVolumeErrorPercent': abs(actual['volume'] - expected['volume']) / expected['volume'] * 100}
    results.append(row)
    print(json.dumps(row), flush=True)
(cohort / 'oracle-comparison.json').write_text(json.dumps({
    'method': 'Symmetric sampled point-to-triangle distances, not an exact Hausdorff bound',
    'evidence': 'Meshes captured from the exact packaged EXE after full original IFC reached Ready',
    'rows': results}, indent=2))
