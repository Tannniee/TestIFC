from pathlib import Path
import json, sys, numpy as np

cohort = Path(__file__).resolve().parent / sys.argv[1]
data = json.loads((cohort / 'selected-meshes.json').read_text())
rows = []
for mesh in data['meshes']:
    positions = np.asarray(mesh['positions'], dtype=np.float32).reshape(-1, 3)
    positions[positions == 0] = 0  # signed zeros share a geometric vertex
    _, geometric = np.unique(positions, axis=0, return_inverse=True)
    triangles = np.asarray(mesh['indices'], dtype=np.int64).reshape(-1, 3)
    t = geometric[triangles]
    oriented = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]])
    signs = np.where(oriented[:, 0] < oriented[:, 1], 1, -1)
    edges, inverse, counts = np.unique(np.sort(oriented, axis=1), axis=0,
                                       return_inverse=True, return_counts=True)
    balances = np.bincount(inverse, weights=signs)
    points = positions[triangles].astype(np.float64)
    cross = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
    row = {'id': mesh['expressId'], 'triangles': len(t),
           'unpairedOrNonmanifoldEdges': int(np.count_nonzero(counts != 2)),
           'directedMismatch': int(np.count_nonzero(balances)),
           'collapsedTriangles': int(np.count_nonzero(np.all(cross == 0, axis=1)))}
    rows.append(row)
    assert all(row[k] == 0 for k in ('unpairedOrNonmanifoldEdges', 'directedMismatch', 'collapsedTriangles')), row
(cohort / 'exact-topology.json').write_text(json.dumps(rows, indent=2))
print(json.dumps(rows))
