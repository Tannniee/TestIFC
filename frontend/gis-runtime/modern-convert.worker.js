import { IfcAPI, IFCPROJECT, IFCBUILDINGSTOREY } from '../node_modules/web-ifc/web-ifc-api.js';
import { packInstances } from './geometry-export.js';

self.onmessage = async ({data:{bytes}}) => {
  const api=new IfcAPI(), geometries=new Map(), instances=[], bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  let model, elements=0, warnings=0;
  const examples=[], logs={log:console.log,warn:console.warn,error:console.error};
  for(const name of Object.keys(logs))console[name]=(...args)=>{const message=args.map(String).join(' ');if(message.includes('[WEB-IFC]')){warnings++;if(examples.length<5)examples.push(message);}else logs[name](...args);};
  try {
    api.SetWasmPath(new URL('./modern/',self.location.href).href,true);await api.Init(undefined,true);
    model=api.OpenModel(new Uint8Array(bytes),{COORDINATE_TO_ORIGIN:true});if(model<0)throw new Error('WebIFC could not open this IFC');
    let lastProgress=0;
    api.StreamAllMeshes(model,(mesh,index,total)=>{
      elements++;
      for(let k=0;k<mesh.geometries.size();k++) {
        const placed=mesh.geometries.get(k), id=placed.geometryExpressID;
        if(!geometries.has(id)) {
          const raw=api.GetGeometry(model,id);
          try {
            const vertex=api.GetVertexArray(raw.GetVertexData(),raw.GetVertexDataSize()),indices=api.GetIndexArray(raw.GetIndexData(),raw.GetIndexDataSize()).slice();
            const positions=new Float64Array(vertex.length/2), normals=new Float32Array(vertex.length/2),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
            for(let i=0;i<vertex.length;i+=6)for(let axis=0;axis<3;axis++) {
              const value=vertex[i+axis];if(!Number.isFinite(value))throw new Error('IFC contains non-finite geometry');
              positions[i/2+axis]=value;normals[i/2+axis]=vertex[i+3+axis];min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
            }
            geometries.set(id,{positions,normals,indices,min,max});
          }finally {raw.delete();}
        }
        const geometry=geometries.get(id);if(!geometry.positions.length||!geometry.indices.length)continue;
        const t=placed.flatTransformation;if(!t.every(Number.isFinite))throw new Error('IFC contains an invalid placement');
        // Exact transformed vertex bounds, not transformed bounding-box estimates.
        const v=geometry.positions;
        for(let i=0;i<v.length;i+=3)for(let axis=0;axis<3;axis++) {
          const value=t[axis]*v[i]+t[4+axis]*v[i+1]+t[8+axis]*v[i+2]+t[12+axis];
          bounds.min[axis]=Math.min(bounds.min[axis],value);bounds.max[axis]=Math.max(bounds.max[axis],value);
        }
        instances.push({geometry:id,transform:[...t],color:[placed.color.x,placed.color.y,placed.color.z,placed.color.w]});
      }
      if(performance.now()-lastProgress>120){lastProgress=performance.now();self.postMessage({type:'progress',stage:'geometry',progress:(index+1)/total});}
    });
    // Empty WebIFC geometries have no glTF accessor and cannot contribute nodes.
    for(const [id,geometry]of geometries)if(!geometry.positions.length||!geometry.indices.length)geometries.delete(id);
    self.postMessage({type:'progress',stage:'packing',progress:0});
    const packed=packInstances(geometries,instances,bounds),coordination=api.GetCoordinationMatrix(model);
    const zeroY=coordination[13],groundOffsetMeters=zeroY>=bounds.min[1]&&zeroY<=bounds.max[1]?zeroY-bounds.min[1]:0;
    const projects=api.GetLineIDsWithType(model,IFCPROJECT),storeys=api.GetLineIDsWithType(model,IFCBUILDINGSTOREY);
    const metadata={schema:api.GetModelSchema(model),coordination,elements,instances:instances.length,uniqueGeometries:geometries.size,triangles:packed.triangles,warnings,warningExamples:examples,origin:packed.origin,span:packed.span,groundOffsetMeters,
      project:projects.size()?api.GetLine(model,projects.get(0)):null,storeys:[]};
    for(let i=0;i<storeys.size();i++){const storey=api.GetLine(model,storeys.get(i));metadata.storeys.push({id:storey.expressID,name:storey.Name?.value,elevation:storey.Elevation?.value});}
    const properties=new TextEncoder().encode(JSON.stringify(metadata)).buffer;
    self.postMessage({type:'done',models:[packed.glb],properties:[properties],metadata},[packed.glb,properties]);
  }catch(error){self.postMessage({type:'error',message:String(error?.message||error)});}
  finally {for(const name of Object.keys(logs))console[name]=logs[name];if(model!==undefined&&model>=0)api.CloseModel(model);api.Dispose();}
};
