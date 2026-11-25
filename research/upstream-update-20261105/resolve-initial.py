from resolve import ROOT, OUT, resolve, edit
import json
import subprocess

# Shared tooling and release versions follow the complete upstream contracts.
support=json.loads((OUT/'support-integration.json').read_text())
for item in support['conflicts']:
    path=item['path']
    if path in ('scripts/perf/README.md','scripts/module-size-allowlist.txt'):
        continue
    resolve(path,'theirs')

# Keep the package's own Windows EPSG generator dependency while updating vitest.
resolve('packages/data/package.json','    "vitest": "^5.0.5",\n    "tsx": "^4.23.15"\n')
resolve('packages/renderer/README.md','both')
# The upstream packer supersedes the per-instance tuple allocation with the same contract.
resolve('packages/renderer/src/instanced-rte.ts','theirs')
# Local disk-flush failure fixture remains meaningful on Windows.
resolve('packages/flow-nodes/src/bcf-publication-local-bounds.test.ts','ours')

resolve('packages/renderer/src/scene.ts',[
    "import { PickOrderMap } from './pick-order-map.js';\nimport { createSceneBatchSteps } from './scene-batch-upload.js';\nimport { finishBatchSteps, sliceBatchSteps } from './batch-slicing.js';\nimport { batchGeometryStaging, type GeometryStagingAllocator } from './geometry-staging.js';\nimport { topologySafeBatchOriginSteps } from './scene-precision.js';\nimport { snapshotBatchMeshes, reconcilePreparedBatch } from './scene-batch-placement.js';\nimport { ResidencyRestore } from './residency-restore.js';\nimport { SceneSnapshotLifecycle, type SceneSnapshotHost } from './scene-snapshot-lifecycle.js';\nimport type { SceneSnapshot } from './scene-snapshot.js';\n",
    'both',
    '  prepareDeviceRecovery(): SceneDeviceRecoveryPreparation { this.snapshots.onDeviceLost(); return prepareSceneDeviceRecovery(this as unknown as SceneRecoveryHost); }\n  discardGpuResourcesForRecovery(): void { this.residencyRestore.clear(); discardSceneGpuResourcesForRecovery(this as unknown as SceneRecoveryHost); }\n',
    'theirs',
    '              yieldTask(() => { void processChunk(); });\n',
    '      onMerged: this.snapshots.mergedSink(bucketKey, batchId),\n    }, bucketKey, allocate);\n    if (reserveId) reconcilePreparedBatch(result, this.modelTranslations, modelIndex, offset, yaw);\n    if (!reserveId) this.nextBatchId++;\n',
])

resolve('packages/renderer/src/scene-precision.ts','ours')
edit('packages/renderer/src/scene-precision.ts',
    'finishBatchSteps(topologySafeBatchOriginSteps(meshes, inherited, shared, routing))',
    'finishBatchSteps(topologySafeBatchOriginSteps(meshes, inherited, shared, routing, memo))')
edit('packages/renderer/src/scene-precision.ts',
    '  routing: [number, number, number] | undefined = undefined,\n): Generator<void, [number, number, number] | undefined> {',
    '  routing: [number, number, number] | undefined = undefined,\n  memo?: TopologyMemo,\n): Generator<void, [number, number, number] | undefined> {\n  function* preserves(origin: readonly [number, number, number]): Generator<void, boolean> {\n    if (memo) return memo.all(meshes, origin);\n    return yield* originPreservesTriangleTopologySteps(meshes, origin);\n  }')
for arg in ('requested','automatic','authored'):
    edit('packages/renderer/src/scene-precision.ts',f'yield* originPreservesTriangleTopologySteps(meshes, {arg})',f'yield* preserves({arg})')

# Retain cooperative allocation/yields and deterministic rollback, migrate uniform arena.
resolve('packages/renderer/src/scene-batch-upload.ts',['both','ours','ours','ours','ours','ours'])
path='packages/renderer/src/scene-batch-upload.ts'
text=(ROOT/path).read_text()
text=text.replace('    lod: boolean;\n','    lod: boolean;\n    onMerged?: (bytes: MergedBatchBytes) => void;\n')
text=text.replace('    /** Handed the exact arrays this batch uploads (scene-snapshot-batches.ts). */\n    onMerged?: (bytes: MergedBatchBytes) => void;\n','')
text=text.replace('    const allocated: GPUBuffer[] = [];','    const allocated: GPUBuffer[] = [];\n    let uniformSlot: MeshUniformSlot | undefined;')
start=text.index('      // Create uniform buffer for this batch')
end=text.index('      // LOD1',start)
text=text[:start]+'''      uniformSlot = meshUniformArena(device, pipeline.getUniformBufferSize()).allocate();
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(),
        entries: [{ binding: 0, resource: { buffer: uniformSlot.buffer, offset: uniformSlot.offset, size: uniformSlot.size } }],
      });

'''+text[end:]
text=text.replace('      let lod1IndexCount: number | undefined;','      let lod1IndexCount: number | undefined;\n      let lodIndices: Uint32Array | null = null;')
text=text.replace('        const lodIndices = yield* simplifyIndicesByClusteringSteps(','        lodIndices = yield* simplifyIndicesByClusteringSteps(')
text=text.replace('      yield;\n      committed = true;','      options.onMerged?.({ vertexData: quantizedData?.vertexData ?? merged.vertexData, indices: merged.indices, ...(lodIndices ? { lod1Indices: lodIndices } : {}) });\n      yield;\n      committed = true;')
text=text.replace('        uniformBuffer,','        uniformSlot,')
text=text.replace('      if (!committed) for (const buffer of allocated) {','      if (!committed) uniformSlot?.release();\n      if (!committed) for (const buffer of allocated) {')
(ROOT/path).write_text(text,encoding='utf-8',newline='\n')
print('Resolved initial package and support conflicts.')
