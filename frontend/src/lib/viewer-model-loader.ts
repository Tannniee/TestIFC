import { FragmentsModels, type FragmentsModel } from "@thatopen/fragments";
import type * as THREE from "three";
import { IfcConverter, sha256Hex } from "./ifc-converter";
import { fragmentArrayBuffer } from "./fragment-buffer";
import { readModelFile } from "./read-model-file";
import { fragmentCacheKey, type FragmentMetadataProfile } from "./fragment-profile";
import { ViewerBridge } from "./viewer-bridge";
import { LoadCancelledError, type BridgeProgress, type ViewerProgress, type FragmentMetrics } from "./viewer-contracts";

interface LoaderCallbacks {
  onProgress(progress: ViewerProgress): void;
  onBridgeProgress(progress: BridgeProgress): void;
  onFragmentMetrics(metrics: FragmentMetrics): void;
  attach(model: FragmentsModel, assertCurrent: () => void): Promise<void>;
  detach(model: FragmentsModel | null): Promise<void>;
  fit(): void;
  update(): Promise<void>;
}

/** Owns file reads, conversion, fragment models and backend preparation as one generation. */
export class ViewerModelLoader {
  readonly fragments = new FragmentsModels("/vendor/fragments/worker.mjs", { maxWorkers: 2 });
  readonly bridge: ViewerBridge;
  private readonly converter: IfcConverter;
  private loadSequence = 0;
  private fileRequest = new AbortController();
  private loadingModelId: string | null = null;
  private disposed = false;
  private readonly loads = new Set<Promise<void>>();
  activeModel: FragmentsModel | null = null;
  activeModelName = "";
  constructor(private readonly camera: THREE.OrthographicCamera, private readonly fragmentProfile: FragmentMetadataProfile,
    private readonly callbacks: LoaderCallbacks) {
    this.converter = new IfcConverter(fragmentProfile);
    this.bridge = new ViewerBridge({ onProgress: (progress) => this.publishBridge(progress.loadSequence, progress) });
  }
  load(file: File): Promise<void> {
    if (this.disposed) return Promise.reject(new LoadCancelledError());
    const task = this.loadCurrent(file);
    this.loads.add(task);
    void task.finally(() => this.loads.delete(task)).catch(() => {});
    return task;
  }
  private async loadCurrent(file: File): Promise<void> {
    const loadStarted = performance.now();
    const sequence = ++this.loadSequence;
    this.fileRequest.abort();
    this.fileRequest = new AbortController();
    void this.bridge.cancelModelRequests().catch((error) => console.warn("Cancel previous load", error));
    this.converter.cancel();
    if (this.loadingModelId) this.fragments.abort(this.loadingModelId);
    await this.clearModel();
    this.assertCurrent(sequence);
    this.publishProgress(sequence, { modelHash: null, stage: "reading", detail: file.name });
    const ifcBuffer = await readModelFile(file, this.fileRequest.signal, (progress) =>
      this.publishProgress(sequence, { modelHash: null, stage: "reading", progress, detail: file.name }));
    const ifcBytes = ifcBuffer.byteLength;
    this.assertCurrent(sequence);
    this.publishProgress(sequence, { modelHash: null, stage: "hashing", detail: file.name });
    const modelHash = await sha256Hex(ifcBuffer);
    this.assertCurrent(sequence);
    void this.bridge.prepareModel(
      file,
      modelHash,
      sequence,
      () => this.assertCurrent(sequence),
    );
    this.publishProgress(sequence, { modelHash, stage: "cache", detail: file.name });
    const cacheKey = fragmentCacheKey(modelHash, this.fragmentProfile);
    let fragmentBuffer: ArrayBuffer | null = null;
    let cacheHit = false;
    let conversionMilliseconds = 0;
    try {
      fragmentBuffer = await this.bridge.fragments(cacheKey);
      cacheHit = fragmentBuffer !== null;
    } catch (error) {
      console.warn(`Fragments cache: ${this.errorText(error)}`);
    }
    this.assertCurrent(sequence);
    if (!fragmentBuffer) {
      this.publishProgress(sequence, { modelHash, stage: "converting", progress: 0, detail: file.name });
      const conversionStarted = performance.now();
      const converted = await this.converter.convert(ifcBuffer, (progress, data) => {
        this.publishProgress(sequence, { modelHash, stage: "converting", progress, detail: file.name,
          phase: data?.process, entitiesProcessed: data?.entitiesProcessed, category: data?.class });
      });
      conversionMilliseconds = performance.now() - conversionStarted;
      this.assertCurrent(sequence);
      fragmentBuffer = fragmentArrayBuffer(converted);
      // fetch snapshots the body before Fragments transfers/detaches the buffer.
      this.bridge.cacheFragments(
        cacheKey,
        converted,
        () => sequence === this.loadSequence && !this.disposed,
      );
    }

    const fragmentBytes = fragmentBuffer.byteLength;
    this.publishProgress(sequence, { modelHash, stage: "loading", progress: 0, detail: file.name });
    const modelId = `${modelHash}-${sequence}`;
    this.loadingModelId = modelId;
    let model: FragmentsModel;
    const fragmentLoadStarted = performance.now();
    let fragmentLoadMilliseconds = 0;
    try {
      model = await this.fragments.load(fragmentBuffer, {
        modelId,
        camera: this.camera,
        onProgress: ({ progress, stage }) => this.publishProgress(sequence, { modelHash, stage: "loading", progress, phase: stage, detail: file.name }),
      });
    } catch (error) {
      if (sequence !== this.loadSequence || this.disposed) throw new LoadCancelledError();
      throw error;
    } finally {
      if (this.loadingModelId === modelId) this.loadingModelId = null;
    }
    fragmentLoadMilliseconds = performance.now() - fragmentLoadStarted;
    if (sequence !== this.loadSequence || this.disposed) {
      await this.fragments.disposeModel(model.modelId);
      throw new LoadCancelledError();
    }
    this.activeModel = model;
    this.activeModelName = file.name;
    this.publishProgress(sequence, { modelHash, stage: "finalizing", detail: file.name });
    await this.callbacks.attach(model, () => this.assertCurrent(sequence));
    this.assertCurrent(sequence);
    await this.callbacks.update();
    this.assertCurrent(sequence);
    this.callbacks.fit();
    const metrics: FragmentMetrics = {
      loadSequence: sequence,
      modelHash,
      profile: this.fragmentProfile,
      cacheHit,
      ifcBytes,
      fragmentBytes,
      conversionMilliseconds,
      fragmentLoadMilliseconds,
      totalMilliseconds: performance.now() - loadStarted,
    };
    this.publishProgress(sequence, { modelHash, stage: "ready", progress: 1, detail: this.activeModelName });
    this.callbacks.onFragmentMetrics(metrics);
  }

  async cancelLoad() {
    ++this.loadSequence;
    this.fileRequest.abort();
    this.converter.cancel();
    if (this.loadingModelId) this.fragments.abort(this.loadingModelId);
    const results = await Promise.allSettled([this.bridge.cancelModelRequests(), this.clearModel()]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  private async clearModel() {
    const model = this.activeModel;
    this.activeModel = null;
    this.activeModelName = "";
    await this.callbacks.detach(model);
    if (model) await this.fragments.disposeModel(model.modelId);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.cancelLoad();
    } finally {
      this.converter.dispose();
      await Promise.allSettled([...this.loads]);
      await this.fragments.dispose();
    }
  }
  private assertCurrent(sequence: number) {
    if (sequence !== this.loadSequence || this.disposed) throw new LoadCancelledError();
  }

  private publishProgress(
    sequence: number,
    progress: Omit<ViewerProgress, "loadSequence">,
  ) {
    if (sequence === this.loadSequence && !this.disposed) {
      this.callbacks.onProgress({ ...progress, loadSequence: sequence });
    }
  }

  private publishBridge(sequence: number, progress: BridgeProgress) {
    if (sequence === this.loadSequence && !this.disposed) this.callbacks.onBridgeProgress(progress);
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
