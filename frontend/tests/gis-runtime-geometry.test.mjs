import test from 'node:test';
import assert from 'node:assert/strict';
import { packInstances } from '../gis-runtime/geometry-export.js';
import { Matrix4, Quaternion, Vector3 } from 'three';

const geometry = { positions: new Float64Array([1e8, 4, 2, 1e8 + .02, 4, 2, 1e8, 5, 3]),
  normals: new Float32Array([0,1,0,0,1,0,0,1,0]), indices: new Uint32Array([0,1,2]), min: [1e8,4,2], max: [1e8+.02,5,3] };
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const instance = transform => ({ geometry: 7, transform, color: [.5,.5,.5,1] });
const decode = glb => {
  const view = new DataView(glb), jsonSize = view.getUint32(12,true);
  return { json: JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,jsonSize))), binaryOffset: 28 + jsonSize };
};
const transformPoint = (t,p) => [0,1,2].map(axis => t[axis]*p[0] + t[4+axis]*p[1] + t[8+axis]*p[2] + t[12+axis]);

test('GLB preserves centimetre geometry at large IFC coordinates and repeated affine placements', () => {
  const rotation = [0,0,-1,0,0,2,0,0,1,0,0,0,1e8,5,1e8,1];
  const bounds = { min: [1e8,0,-1], max: [1e8+4,15,10] };
  const result = packInstances(new Map([[7,geometry]]),[instance(identity),instance(rotation)],bounds);
  const {json,binaryOffset}=decode(result.glb);
  assert.equal(json.meshes.length,1); assert.equal(json.nodes.length,1); assert.equal(result.triangles,2);
  const attribute=json.accessors[json.meshes[0].primitives[0].attributes.POSITION],buffer=json.bufferViews[attribute.bufferView];
  const points=new Float32Array(result.glb,binaryOffset+buffer.byteOffset,attribute.count*3);
  const readAttribute=id=>{const attribute=json.accessors[id],buffer=json.bufferViews[attribute.bufferView];return new Float32Array(result.glb,binaryOffset+buffer.byteOffset,attribute.count*(attribute.type==='VEC4'?4:3));};
  const attributes=json.nodes[0].extensions.EXT_mesh_gpu_instancing.attributes;
  const translations=readAttribute(attributes.TRANSLATION),rotations=readAttribute(attributes.ROTATION),scales=readAttribute(attributes.SCALE);
  for(let n=0;n<2;n++) for(let i=0;i<3;i++) {
    const expected=transformPoint([identity,rotation][n],Array.from(geometry.positions.slice(i*3,i*3+3))).map((value,axis)=>value-result.origin[axis]);
    const matrix=new Matrix4().compose(new Vector3().fromArray(translations,n*3),new Quaternion().fromArray(rotations,n*4),new Vector3().fromArray(scales,n*3));
    const actual=transformPoint(matrix.elements,Array.from(points.slice(i*3,i*3+3)));
    expected.forEach((value,axis)=>assert.ok(Math.abs(actual[axis]-value)<1e-5));
  }
  assert.ok(Math.abs((points[3]-points[0])-.02)<1e-6);
});

test('GLB rejects the collapsed zero-extent output that previously marked TTHC ready', () => {
  assert.throws(()=>packInstances(new Map([[7,geometry]]),[instance(identity)],{min:[0,0,0],max:[0,0,0]}),/zero or invalid extent/);
  assert.throws(()=>packInstances(new Map(),[],{min:[0,0,0],max:[1,1,1]}),/no triangles/);
});
