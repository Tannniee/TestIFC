import type { EngineV2ArtifactBuffers } from "./artifact-reader.ts";

const HEADER_BYTES = 32;

function safeUint64(view: DataView, offset: number, label: string): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the JavaScript safe-integer range`);
  return Number(value);
}

class Records {
  readonly view: DataView;
  readonly buffer: ArrayBuffer;
  readonly stride: number;
  readonly count: number;
  readonly label: string;

  constructor(buffer: ArrayBuffer, stride: number, count: number, label: string) {
    this.buffer = buffer;
    this.stride = stride;
    this.count = count;
    this.label = label;
    if (buffer.byteLength !== HEADER_BYTES + stride * count) throw new Error(`${label} has an invalid byte length`);
    this.view = new DataView(buffer);
  }
  offset(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw new RangeError(`${this.label} record is outside the table`);
    return HEADER_BYTES + index * this.stride;
  }
}

export interface EngineV2MeshRecord {
  baseId: number;
  representativeProductId: number;
  firstIndex: number;
  indexCount: number;
  faceCount: number;
  occurrenceCount: number;
  bounds: [number, number, number, number, number, number];
}

export interface EngineV2InstanceRecord {
  productId: number;
  baseId: number;
  sourceItemId: number;
  flags: number;
  matrix: Float64Array;
}

export interface EngineV2ProductRecord {
  productId: number;
  productDefinitionId: number;
  firstInstance: number;
  instanceCount: number;
  typeId: number;
}

export interface EngineV2MaterialRecord {
  ordinal: number;
  flags: number;
  rgba: [number, number, number, number];
}

export class EngineV2BinaryTables {
  readonly artifact: EngineV2ArtifactBuffers;
  private readonly positions: Records;
  private readonly meshes: Records;
  private readonly instances: Records;
  private readonly products: Records;
  private readonly materials: Records;
  readonly indices: Uint32Array;
  readonly normals: Int16Array;
  readonly instanceMaterials: Uint32Array;

  constructor(artifact: EngineV2ArtifactBuffers) {
    this.artifact = artifact;
    const { manifest, chunks } = artifact;
    this.positions = new Records(chunks["positions-f64.ifcv2"], 32, manifest.cartesianPoints, "positions-f64.ifcv2");
    this.meshes = new Records(chunks["meshes.ifcv2"], 56, manifest.baseDefinitions, "meshes.ifcv2");
    this.instances = new Records(chunks["instances.ifcv2"], 112, manifest.instances, "instances.ifcv2");
    this.products = new Records(chunks["products.ifcv2"], 24, manifest.products, "products.ifcv2");
    this.materials = new Records(
      chunks["materials.ifcv2"], 32, manifest.materials.materialDefinitions, "materials.ifcv2",
    );
    this.indices = new Uint32Array(chunks["indices.ifcv2"], HEADER_BYTES, manifest.indices);
    this.normals = new Int16Array(chunks["normals.ifcv2"], HEADER_BYTES, manifest.triangles * 2);
    this.instanceMaterials = new Uint32Array(chunks["instance-materials.ifcv2"], HEADER_BYTES, manifest.instances);
  }

  position(ordinal: number, target: Float64Array | number[] = new Float64Array(3)) {
    const offset = this.positions.offset(ordinal);
    target[0] = this.positions.view.getFloat64(offset + 8, true);
    target[1] = this.positions.view.getFloat64(offset + 16, true);
    target[2] = this.positions.view.getFloat64(offset + 24, true);
    return target;
  }

  mesh(index: number): EngineV2MeshRecord {
    const offset = this.meshes.offset(index);
    const bounds = [] as number[];
    for (let component = 0; component < 6; component++) bounds.push(this.meshes.view.getFloat32(offset + 32 + component * 4, true));
    return {
      baseId: this.meshes.view.getInt32(offset, true),
      representativeProductId: this.meshes.view.getInt32(offset + 4, true),
      firstIndex: safeUint64(this.meshes.view, offset + 8, "mesh firstIndex"),
      indexCount: this.meshes.view.getInt32(offset + 16, true),
      faceCount: this.meshes.view.getInt32(offset + 20, true),
      occurrenceCount: this.meshes.view.getInt32(offset + 24, true),
      bounds: bounds as EngineV2MeshRecord["bounds"],
    };
  }

  instance(index: number, matrix = new Float64Array(12)): EngineV2InstanceRecord {
    const offset = this.instances.offset(index);
    for (let component = 0; component < 12; component++) matrix[component] = this.instances.view.getFloat64(offset + 16 + component * 8, true);
    return {
      productId: this.instances.view.getInt32(offset, true),
      baseId: this.instances.view.getInt32(offset + 4, true),
      sourceItemId: this.instances.view.getInt32(offset + 8, true),
      flags: this.instances.view.getUint32(offset + 12, true),
      matrix,
    };
  }

  product(index: number): EngineV2ProductRecord {
    const offset = this.products.offset(index);
    return {
      productId: this.products.view.getInt32(offset, true),
      productDefinitionId: this.products.view.getInt32(offset + 4, true),
      firstInstance: safeUint64(this.products.view, offset + 8, "product firstInstance"),
      instanceCount: this.products.view.getInt32(offset + 16, true),
      typeId: this.products.view.getUint16(offset + 20, true),
    };
  }

  material(index: number): EngineV2MaterialRecord {
    const offset = this.materials.offset(index);
    return {
      ordinal: this.materials.view.getUint32(offset, true),
      flags: this.materials.view.getUint32(offset + 12, true),
      rgba: [
        this.materials.view.getFloat32(offset + 16, true),
        this.materials.view.getFloat32(offset + 20, true),
        this.materials.view.getFloat32(offset + 24, true),
        this.materials.view.getFloat32(offset + 28, true),
      ],
    };
  }
}
