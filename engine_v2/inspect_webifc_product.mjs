import fs from "node:fs";
import { IfcAPI } from "../frontend/node_modules/web-ifc/web-ifc-api-node.js";

const [sourcePath, productArgument] = process.argv.slice(2);
const productExpressId = Number(productArgument);
if (!sourcePath || !Number.isInteger(productExpressId) || productExpressId <= 0) {
  console.error("Usage: node engine_v2/inspect_webifc_product.mjs <model.ifc> <product-express-id>");
  process.exit(2);
}

const api = new IfcAPI();
await api.Init();
const source = fs.readFileSync(sourcePath);
const modelId = api.OpenModel(source, { COORDINATE_TO_ORIGIN: false });
try {
  const mesh = api.GetFlatMesh(modelId, productExpressId);
  const geometries = [];
  for (let index = 0; index < mesh.geometries.size(); index++) {
    const placed = mesh.geometries.get(index);
    const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
    const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let offset = 0; offset < vertices.length; offset += 6) {
      bounds[0] = Math.min(bounds[0], vertices[offset]);
      bounds[1] = Math.min(bounds[1], vertices[offset + 1]);
      bounds[2] = Math.min(bounds[2], vertices[offset + 2]);
      bounds[3] = Math.max(bounds[3], vertices[offset]);
      bounds[4] = Math.max(bounds[4], vertices[offset + 1]);
      bounds[5] = Math.max(bounds[5], vertices[offset + 2]);
    }
    geometries.push({
      geometryExpressId: placed.geometryExpressID,
      color: placed.color,
      flatTransformation: Array.from(placed.flatTransformation),
      vertexBounds: bounds,
      vertexCount: vertices.length / 6,
      triangleCount: geometry.GetIndexDataSize() / 3,
    });
    geometry.delete();
  }
  console.log(JSON.stringify({
    productExpressId,
    coordinationMatrix: Array.from(api.GetCoordinationMatrix(modelId)),
    geometries,
  }, null, 2));
} finally {
  api.CloseModel(modelId);
}
