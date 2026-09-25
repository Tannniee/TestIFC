import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { IfcAPI } from "../frontend/node_modules/web-ifc/web-ifc-api-node.js";

const [sourcePath] = process.argv.slice(2);
if (!sourcePath) {
  console.error("Usage: node engine_v2/measure_webifc_triangles.mjs <model.ifc>");
  process.exit(2);
}

const api = new IfcAPI();
await api.Init();
const source = fs.readFileSync(sourcePath);
const openedAt = performance.now();
const modelId = api.OpenModel(source, { COORDINATE_TO_ORIGIN: false });
const parsedAt = performance.now();
try {
  const trianglesByGeometry = new Map();
  let flatMeshes = 0;
  let placedGeometries = 0;
  let triangles = 0;
  api.StreamAllMeshes(modelId, (mesh) => {
    flatMeshes++;
    for (let geometryIndex = 0; geometryIndex < mesh.geometries.size(); geometryIndex++) {
      const placed = mesh.geometries.get(geometryIndex);
      let geometryTriangles = trianglesByGeometry.get(placed.geometryExpressID);
      if (geometryTriangles === undefined) {
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        geometryTriangles = geometry.GetIndexDataSize() / 3;
        trianglesByGeometry.set(placed.geometryExpressID, geometryTriangles);
        geometry.delete();
      }
      placedGeometries++;
      triangles += geometryTriangles;
    }
  });
  const countedAt = performance.now();
  console.log(JSON.stringify({
    sourceBytes: source.byteLength,
    flatMeshes,
    placedGeometries,
    uniqueGeometries: trianglesByGeometry.size,
    triangles,
    parseMilliseconds: parsedAt - openedAt,
    streamAndCountMilliseconds: countedAt - parsedAt,
    totalMilliseconds: countedAt - openedAt,
  }));
} finally {
  api.CloseModel(modelId);
}
