/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { finishBatchSteps, sliceBatchSteps, type BatchScheduling } from './batch-slicing.js';
import type { GeometryStagingAllocator } from './geometry-staging.js';
import type { MeshData } from '@ifc-lite/geometry';
import type { BatchedMesh } from './types.js';
import type { RenderPipeline } from './pipeline.js';
import { mergeGeometry, mergeGeometrySteps } from './scene-geometry.js';
import { BATCH_CONSTANTS } from './constants.js';
import { quantizeInterleavedSteps } from './quantize.js';
import { createStaticGpuBuffer } from './gpu-static-upload.js';
import { batchGeometryStaging } from './geometry-staging.js';
import type { BatchQuantization } from './scene-derived-batches.js';
import {
  simplifyIndicesByClusteringSteps,
  lodCellSizeForBounds,
  LOD_MIN_TRIANGLES,
} from './lod-simplify.js';

/** Stage a complete GPU batch. No Scene state changes until this succeeds. */
export function createSceneBatch(
  meshDataArray: MeshData[],
  color: [number, number, number, number],
  device: GPUDevice,
  pipeline: RenderPipeline,
  options: {
    id: number;
    colorKey: string;
    /** Already validated by Scene before this GPU allocation boundary. */
    origin: [number, number, number];
    /** See `BatchQuantization`; derived batches pass their source's decision (#4832). */
    quantized: BatchQuantization;
    lod: boolean;
  },
  bucketKey?: string,
): BatchedMesh {
  return batchGeometryStaging.use(allocate => finishBatchSteps(createSceneBatchSteps(meshDataArray, color, device, pipeline, options, bucketKey, allocate)));
}

export function createSceneBatchAsync(
  meshDataArray: MeshData[],
  color: [number, number, number, number],
  device: GPUDevice,
  pipeline: RenderPipeline,
  options: {
    id: number;
    colorKey: string;
    /** Already validated by Scene before this GPU allocation boundary. */
    origin: [number, number, number];
    /** See `BatchQuantization`; derived batches pass their source's decision (#4832). */
    quantized: BatchQuantization;
    lod: boolean;
  },
  bucketKey?: string,
  scheduling: BatchScheduling = {},
): Promise<BatchedMesh> {
  return batchGeometryStaging.useAsync(allocate => sliceBatchSteps(createSceneBatchSteps(meshDataArray, color, device, pipeline, options, bucketKey, allocate), scheduling));
}

export function* createSceneBatchSteps(
  meshDataArray: MeshData[],
  color: [number, number, number, number],
  device: GPUDevice,
  pipeline: RenderPipeline,
  options: {
    id: number;
    colorKey: string;
    /** Already validated by Scene before this GPU allocation boundary. */
    origin: [number, number, number];
    /** See `BatchQuantization`; derived batches pass their source's decision (#4832). */
    quantized: BatchQuantization;
    lod: boolean;
  },
  bucketKey: string | undefined,
  allocate: GeometryStagingAllocator,
): Generator<void, BatchedMesh> {

    // Use ONE shared scene origin for every batch (set from the first batch's
    // world bbox centre). A per-batch origin would make abutting elements in
    // different colour batches diverge by a few f32 ULP at building-scale world
    // coords → seam/end-cap z-fighting. A shared origin makes every coincident
    // world point relativize identically → no seam z-fight, and the model
    // sits at most ±(model extent) from it (f32-precise at building scale).
    const merged = yield* mergeGeometrySteps(meshDataArray, options.origin, allocate);
    const expressIds = meshDataArray.map((m) => m.expressId);
    // Parallel to `expressIds` (same index = same source piece) so picking
    // can scope each batch ENTRY to its own model — batches group by colour,
    // not by model, so distinct models sharing an expressId+colour can be
    // co-batched (see BatchedMesh.modelIndices doc).
    const modelIndices = meshDataArray.map((m) => m.modelIndex);

    // Create vertex buffer (interleaved positions + normals) through
    // `createStaticGpuBuffer` — never `mappedAtCreation`, which on Chromium pins
    // a hidden shared-memory copy of the whole buffer for its lifetime (#5429).
    // Quantized path (issue #1682 phase 6): 12-byte lattice records instead
    // of the 28-byte f32 layout. Falls back to f32 when the batch exceeds
    // the u16 lattice range. Order note: the LOD build further down reads
    // merged.vertexData (the CPU f32 copy) and produces INDICES only, which
    // are valid for either vertex format.
    // This function allocates a RUN of GPU buffers (vertex, index, uniform,
    // and — when LOD1 qualifies — a second index buffer). A GPU call in the run
    // can still throw synchronously (Safari throws `InvalidStateError` on a
    // lost device; a test or host shim may throw anything), so every
    // buffer created earlier in the run must be destroyed before a later throw
    // propagates — otherwise it is orphaned: allocated, never referenced again,
    // never freed. Same paired-allocation idiom as `appendChunkToNode` /
    // `DeviationPipeline.uploadBvh` (see paired-buffer-leak.test.ts), generalised
    // to a run of N instead of a pair.
    const allocated: GPUBuffer[] = [];
    const track = (buffer: GPUBuffer): GPUBuffer => {
      allocated.push(buffer);
      return buffer;
    };
    let committed = false;
    try {
      let quantized: { min: [number, number, number]; step: number } | undefined;
      let vertexBuffer: GPUBuffer;
      const quantizedData = options.quantized !== 'off'
        ? yield* quantizeInterleavedSteps(
            merged.vertexData,
            BATCH_CONSTANTS.BYTES_PER_VERTEX / 4,
          )
        : null;
      if (!quantizedData && options.quantized === 'required') {
        // A subset of a quantized batch always fits its lattice range, so this
        // cannot happen unless the derived batch was built from pieces outside
        // its source batch. Say so: a partial sub-batch drawn instead of its
        // source would otherwise resolve coplanar faces differently, silently.
        console.warn(
          `[Scene] derived batch ${options.colorKey} could not inherit its source batch's quantization; ` +
          'its partial-batch depth will not match the base geometry (#4832).',
        );
      }
      if (quantizedData) {
        vertexBuffer = track(createStaticGpuBuffer(device, quantizedData.vertexData, GPUBufferUsage.VERTEX));
        quantized = { min: quantizedData.quantMin, step: quantizedData.step };
      } else {
        vertexBuffer = track(createStaticGpuBuffer(device, merged.vertexData, GPUBufferUsage.VERTEX));
      }

      yield;
      // Create index buffer
      const indexBuffer = track(createStaticGpuBuffer(device, merged.indices, GPUBufferUsage.INDEX));

      yield;
      // Create uniform buffer for this batch
      const uniformBuffer = track(device.createBuffer({
        size: pipeline.getUniformBufferSize(),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));

      // Create bind group
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(),
        entries: [
          {
            binding: 0,
            resource: { buffer: uniformBuffer },
          },
        ],
      });

      // LOD1 (issue #1682 phase 5): simplified second index range over the SAME
      // vertex buffer. Bucket-owned batches only (`bucketKey` present) — the
      // transient streaming fragments and partial/overlay sub-batches never pay
      // the build. Positions in `merged.vertexData` are relative to the batch
      // origin, which is fine: clustering is translation-invariant as long as
      // the cell size comes from the same-space bounds extent.
      let lod1IndexBuffer: GPUBuffer | undefined;
      let lod1IndexCount: number | undefined;
      if (
        options.lod &&
        bucketKey !== undefined &&
        merged.bounds &&
        merged.indices.length >= LOD_MIN_TRIANGLES * 3
      ) {
        const cellSize = lodCellSizeForBounds(
          merged.bounds.min,
          merged.bounds.max,
        );
        const lodIndices = yield* simplifyIndicesByClusteringSteps(
          merged.vertexData,
          BATCH_CONSTANTS.BYTES_PER_VERTEX / 4,
          merged.indices,
          cellSize,
        );
        if (lodIndices) {
          lod1IndexBuffer = track(createStaticGpuBuffer(device, lodIndices, GPUBufferUsage.INDEX));
          lod1IndexCount = lodIndices.length;
        }
      }

      yield;
      committed = true;
      return {
        id: options.id,
        colorKey: options.colorKey,
        vertexBuffer,
        indexBuffer,
        indexCount: merged.indices.length,
        color,
        // #5582: every piece in a bucket shares its material (the colour key
        // folds it in — see Scene.colorKey), so the first piece speaks for all.
        ...(meshDataArray[0]?.material ? { finish: meshDataArray[0].material } : {}),
        expressIds,
        bindGroup,
        uniformBuffer,
        bounds: merged.bounds,
        modelIndices,
        // Per-batch local frame: positions are stored relative to this; the draw
        // loop applies model = translate(origin) so they land in world space.
        origin: merged.origin,
        ...(lod1IndexBuffer ? { lod1IndexBuffer, lod1IndexCount } : {}),
        ...(quantized ? { quantized } : {}),
      };
    } finally {
      if (!committed) for (const buffer of allocated) {
        try {
          buffer.destroy();
        } catch (disposeError) {
          console.warn('[Scene] batch rollback disposal failed', disposeError);
        }
      }
    }
}

/** Repartition an evicted batch without allocating replacement GPU buffers. */
export function createSceneBatchShell(
  meshDataArray: MeshData[],
  source: BatchedMesh,
  id: number,
  colorKey: string,
): BatchedMesh {
  const merged = mergeGeometry(meshDataArray, source.origin);
  return {
    id,
    colorKey,
    vertexBuffer: source.vertexBuffer,
    indexBuffer: source.indexBuffer,
    indexCount: merged.indices.length,
    color: meshDataArray[0].color,
    ...(meshDataArray[0]?.material ? { finish: meshDataArray[0].material } : {}), // #5582
    expressIds: meshDataArray.map((mesh) => mesh.expressId),
    modelIndices: meshDataArray.map((mesh) => mesh.modelIndex),
    bounds: merged.bounds,
    origin: merged.origin,
    gpuResident: false,
  };
}
