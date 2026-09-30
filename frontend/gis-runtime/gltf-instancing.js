import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

// Equivalent to Three's current GLTFMeshGpuInstancing hook, for the isolated
// WebGL1-compatible Three 0.135 runtime. Implements the standard TRS attributes.
export class GltfInstancing {
  constructor(parser) { this.parser=parser;this.name='EXT_mesh_gpu_instancing'; }
  createNodeMesh(index) {
    const definition=this.parser.json.nodes[index],extension=definition.extensions?.[this.name];
    if(!extension)return null;
    return Promise.all([
      this.parser.createNodeMesh(index),
      this.parser.getDependency('accessor',extension.attributes.TRANSLATION),
      this.parser.getDependency('accessor',extension.attributes.ROTATION),
      this.parser.getDependency('accessor',extension.attributes.SCALE),
    ]).then(([object,translations,rotations,scales])=>{
      const group=new Group(),matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
      for(const source of object.isGroup?object.children:[object]) {
        const mesh=new InstancedMesh(source.geometry,source.material,translations.count);
        let maxScale=0;
        for(let i=0;i<translations.count;i++) {
          position.fromBufferAttribute(translations,i);rotation.fromBufferAttribute(rotations,i);scale.fromBufferAttribute(scales,i);
          maxScale=Math.max(maxScale,Math.abs(scale.x),Math.abs(scale.y),Math.abs(scale.z));
          mesh.setMatrixAt(i,matrix.compose(position,rotation,scale));
        }
        mesh.instanceMatrix.needsUpdate=true;
        // Three 0.135 does not aggregate instance bounds; the map owns framing.
        source.geometry.computeBoundingSphere();
        mesh.userData.gisDetailRadius=source.geometry.boundingSphere.radius*maxScale;
        mesh.frustumCulled=false;this.parser.assignFinalMaterial(mesh);group.add(mesh);
      }
      return group;
    });
  }
}
