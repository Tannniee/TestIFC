import { Matrix4, Quaternion, Vector3 } from 'three';

/** Preserve shared IFC meshes in standard glTF EXT_mesh_gpu_instancing nodes.
 * Coordinates remain doubles until rebasing, before any Float32 conversion. */
export function packInstances(geometries,instances,bounds) {
  const origin=[(bounds.min[0]+bounds.max[0])/2,bounds.min[1],(bounds.min[2]+bounds.max[2])/2];
  const span=bounds.max.map((value,axis)=>value-bounds.min[axis]);
  if(!span.every(Number.isFinite)||Math.max(...span)<=1e-6)throw new Error('IFC geometry has zero or invalid extent');
  const extension='EXT_mesh_gpu_instancing';
  const json={asset:{version:'2.0',generator:'TestIFC WebIFC 0.0.78'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],extensionsUsed:[extension],extensionsRequired:[extension]};
  const binary=[],shapes=new Map(),groups=new Map(),materials=new Map();
  let offset=0,triangles=0;
  const accessor=(array,type,componentType,target,extra={})=>{
    const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:array.byteLength,...(target?{target}:{})})-1;
    binary.push(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));offset+=array.byteLength;
    return json.accessors.push({bufferView:view,componentType,count:array.length/({VEC3:3,VEC4:4,SCALAR:1}[type]),type,...extra})-1;
  };
  for(const [id,geometry]of geometries) {
    const localOrigin=geometry.min.map((value,axis)=>(value+geometry.max[axis])/2),positions=new Float32Array(geometry.positions.length);
    for(let i=0;i<positions.length;i++)positions[i]=geometry.positions[i]-localOrigin[i%3];
    shapes.set(id,{origin:localOrigin,triangles:geometry.indices.length/3,
      attributes:{POSITION:accessor(positions,'VEC3',5126,34962,{min:geometry.min.map((value,axis)=>value-localOrigin[axis]),max:geometry.max.map((value,axis)=>value-localOrigin[axis])}),NORMAL:accessor(geometry.normals,'VEC3',5126,34962)},indices:accessor(geometry.indices,'SCALAR',5125,34963)});
  }
  for(const instance of instances) {
    const key=`${instance.geometry}:${instance.color.join(',')}`;
    if(!groups.has(key))groups.set(key,{geometry:instance.geometry,color:instance.color,instances:[]});groups.get(key).instances.push(instance);
  }
  const matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
  for(const group of groups.values()) {
    const shape=shapes.get(group.geometry),colorKey=group.color.join(',');
    if(!materials.has(colorKey))materials.set(colorKey,json.materials.push({pbrMetallicRoughness:{baseColorFactor:group.color,metallicFactor:0,roughnessFactor:.85},doubleSided:true,alphaMode:group.color[3]<1?'BLEND':'OPAQUE'})-1);
    const mesh=json.meshes.push({primitives:[{attributes:shape.attributes,indices:shape.indices,material:materials.get(colorKey)}]})-1;
    const count=group.instances.length,translations=new Float32Array(count*3),rotations=new Float32Array(count*4),scales=new Float32Array(count*3);
    for(let i=0;i<count;i++) {
      matrix.fromArray(group.instances[i].transform);const t=matrix.elements,p=shape.origin;
      for(let axis=0;axis<3;axis++)t[12+axis]+=t[axis]*p[0]+t[4+axis]*p[1]+t[8+axis]*p[2]-origin[axis];
      matrix.decompose(position,rotation,scale);position.toArray(translations,i*3);rotation.toArray(rotations,i*4);scale.toArray(scales,i*3);
    }
    const attributes={TRANSLATION:accessor(translations,'VEC3',5126),ROTATION:accessor(rotations,'VEC4',5126),SCALE:accessor(scales,'VEC3',5126)};
    json.scenes[0].nodes.push(json.nodes.push({mesh,extensions:{[extension]:{attributes}}})-1);triangles+=shape.triangles*count;
  }
  if(!triangles)throw new Error('IFC contains no triangles');
  json.buffers[0].byteLength=offset;
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonSize=Math.ceil(encoded.length/4)*4;
  const glb=new ArrayBuffer(12+8+jsonSize+8+offset),data=new DataView(glb),bytes=new Uint8Array(glb);
  data.setUint32(0,0x46546c67,true);data.setUint32(4,2,true);data.setUint32(8,glb.byteLength,true);
  data.setUint32(12,jsonSize,true);data.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonSize);bytes.set(encoded,20);
  data.setUint32(20+jsonSize,offset,true);data.setUint32(24+jsonSize,0x004e4942,true);
  let cursor=28+jsonSize;for(const chunk of binary){bytes.set(chunk,cursor);cursor+=chunk.length;}
  return {glb,origin,span,triangles};
}
