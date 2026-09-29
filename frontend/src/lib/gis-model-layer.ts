import * as THREE from "three";
import type { FragmentsModel } from "@thatopen/fragments";
import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibreMap } from "maplibre-gl";
import type { ManualAnchor } from "./api-contracts";
import type { GisModelBounds } from "./gis-footprint";
import { georeferencedMercatorMatrix, modelMercatorMatrix, type GisControlPoints } from "./gis-placement";

const MAX_PREVIEW_TRIANGLES = 500_000;
const BATCH_SIZE = 32;
export type GisPlacement = { kind: "manual"; anchor: ManualAnchor }
  | { kind: "ifc"; controlPoints: GisControlPoints };

/** A map overlay owns its geometry: Fragments frees the viewer's CPU buffers
 * after upload, so its tile meshes cannot be shared with MapLibre's context. */
export class GisModelOverlay {
  readonly layer: CustomLayerInterface;
  readonly scene = new THREE.Scene();
  private readonly meshes = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera();
  private renderer: THREE.WebGLRenderer | null = null;
  private map: MapLibreMap | null = null;
  private placement: THREE.Matrix4 | null = null;
  private coordination = new THREE.Matrix4();
  private disposed = false;
  private material = new THREE.MeshLambertMaterial({ color: 0x419cb0, side: THREE.DoubleSide });
  private selectedMaterial = new THREE.MeshLambertMaterial({ color: 0xffc65c, side: THREE.DoubleSide });
  readonly stats = { elements: 0, triangles: 0, truncated: false };

  constructor(private readonly model: FragmentsModel, private readonly bounds: GisModelBounds) {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(0.4, 1, 0.7);
    this.scene.add(sun, this.meshes);
    this.layer = {
      id: "gis-ifc-model-3d", type: "custom", renderingMode: "3d",
      onAdd: (map, gl) => {
        this.map = map;
        this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        this.renderer.autoClear = false;
      },
      render: (_gl, args) => {
        if (!this.renderer || !this.placement) return;
        this.camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(this.placement);
        this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
        this.camera.matrixWorld.identity();
        this.camera.matrixWorldInverse.identity();
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
      },
      onRemove: () => {
        this.renderer?.dispose();
        this.renderer = null;
        this.map = null;
      },
    };
  }

  async build(signal?: AbortSignal): Promise<typeof this.stats> {
    this.coordination = await this.model.getCoordinationMatrix();
    const ids = await this.model.getItemsIdsWithGeometry();
    if (this.disposed || signal?.aborted) return this.stats;
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      if (this.disposed || signal?.aborted) break;
      const batch = ids.slice(offset, offset + BATCH_SIZE);
      const groups = await this.model.getItemsGeometry(batch);
      if (this.disposed || signal?.aborted) break;
      for (let i = 0; i < groups.length; i++) {
        for (const data of groups[i]) {
          if (!data.positions?.length || !data.indices?.length) continue;
          const triangles = data.indices.length / 3;
          if (this.stats.triangles + triangles > MAX_PREVIEW_TRIANGLES) {
            this.stats.truncated = true;
            return this.stats;
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(
            data.positions instanceof Float64Array ? new Float32Array(data.positions) : data.positions, 3));
          geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
          if (data.normals?.length) geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3, true));
          else geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, this.material);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(data.transform);
          mesh.userData.localId = data.localId ?? batch[i];
          this.meshes.add(mesh);
          this.stats.triangles += triangles;
          this.stats.elements++;
        }
      }
    }
    this.map?.triggerRepaint();
    return this.stats;
  }

  setPlacement(placement: GisPlacement | null) {
    if (placement?.kind === "manual") {
      const { anchor } = placement;
      const origin = MercatorCoordinate.fromLngLat(
        [anchor.longitude, anchor.latitude], anchor.elevationMeters);
      this.placement = modelMercatorMatrix(anchor, this.bounds, {
        x: origin.x, y: origin.y, z: origin.z,
        meterScale: origin.meterInMercatorCoordinateUnits(),
      });
    } else if (placement?.kind === "ifc") {
      const points = placement.controlPoints;
      this.placement = georeferencedMercatorMatrix({
        origin: MercatorCoordinate.fromLngLat([points.origin.longitude, points.origin.latitude], points.origin.elevationMeters),
        east: MercatorCoordinate.fromLngLat([points.east.longitude, points.east.latitude], points.east.elevationMeters),
        north: MercatorCoordinate.fromLngLat([points.north.longitude, points.north.latitude], points.north.elevationMeters),
        up: MercatorCoordinate.fromLngLat([points.up.longitude, points.up.latitude], points.up.elevationMeters),
      }, this.coordination);
    } else this.placement = null;
    this.map?.triggerRepaint();
  }

  footprint(): [number, number][] | null {
    if (!this.placement) return null;
    const { minEast, maxEast, minNorth, maxNorth, minHeight } = this.bounds;
    const corners = [
      [minEast, -minNorth], [maxEast, -minNorth],
      [maxEast, -maxNorth], [minEast, -maxNorth],
    ];
    const ring: [number, number][] = [];
    for (const [x, z] of corners) {
      const world = new THREE.Vector3(x, minHeight, z).applyMatrix4(this.placement);
      const position = new MercatorCoordinate(world.x, world.y, world.z).toLngLat();
      if (!Number.isFinite(position.lng) || !Number.isFinite(position.lat)
        || Math.abs(position.lng) > 180 || Math.abs(position.lat) >= 85.05112878) return null;
      ring.push([position.lng, position.lat]);
    }
    return [...ring, ring[0]];
  }

  elevationRange(): [number, number] | null {
    if (!this.placement) return null;
    const x = (this.bounds.minEast + this.bounds.maxEast) / 2;
    const z = -(this.bounds.minNorth + this.bounds.maxNorth) / 2;
    const altitude = (y: number) => {
      const point = new THREE.Vector3(x, y, z).applyMatrix4(this.placement!);
      return new MercatorCoordinate(point.x, point.y, point.z).toAltitude();
    };
    const low = altitude(this.bounds.minHeight), high = altitude(this.bounds.maxHeight);
    return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : null;
  }

  setSelectedIds(ids: readonly number[]) {
    const selected = new Set(ids);
    let changed = false;
    for (const object of this.meshes.children) {
      if (!(object instanceof THREE.Mesh)) continue;
      const material = selected.has(object.userData.localId) ? this.selectedMaterial : this.material;
      if (object.material !== material) { object.material = material; changed = true; }
    }
    if (changed) this.map?.triggerRepaint();
  }

  pick(pixel: { x: number; y: number }, width: number, height: number): number | null {
    if (!this.placement || !this.renderer || !width || !height) return null;
    const mouse = new THREE.Vector2(pixel.x / width * 2 - 1, 1 - pixel.y / height * 2);
    const near = new THREE.Vector3(mouse.x, mouse.y, -1).applyMatrix4(this.camera.projectionMatrixInverse);
    const far = new THREE.Vector3(mouse.x, mouse.y, 1).applyMatrix4(this.camera.projectionMatrixInverse);
    const ray = new THREE.Raycaster();
    ray.set(near, far.sub(near).normalize());
    const hit = ray.intersectObjects(this.meshes.children, false)[0];
    return typeof hit?.object.userData.localId === "number" ? hit.object.userData.localId : null;
  }

  dispose() {
    this.disposed = true;
    if (this.map?.getLayer(this.layer.id)) this.map.removeLayer(this.layer.id);
    this.meshes.traverse(object => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.meshes.clear();
    this.material.dispose();
    this.selectedMaterial.dispose();
  }
}
