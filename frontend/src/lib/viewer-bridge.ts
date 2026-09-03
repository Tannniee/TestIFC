import { api, ApiError, type ActivateModelResponse } from "./api";
import { isLoadCancelledError, LoadCancelledError, type BridgeProgress, type ViewerSelection } from "./viewer-contracts";
import { createSelectionPayload } from "./viewer-selection";

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
// Preserve write ordering across viewer remounts in the same window as well.
let activationQueue: Promise<void> = Promise.resolve();

export interface ViewerBridgeCallbacks {
  onProgress(progress: BridgeProgress): void;
}

export class ViewerBridge {
  private retryAction: (() => Promise<void>) | null = null;
  async retrySemantic() { await this.retryAction?.(); }

  private fragmentRequests = new AbortController();
  private preparation: { controller: AbortController; activated?: ActivateModelResponse } | null = null;

  constructor(private readonly callbacks: ViewerBridgeCallbacks) {}

  cancelFragmentRequests() {
    this.fragmentRequests.abort();
    this.fragmentRequests = new AbortController();
  }

  cancelModelRequests(): Promise<void> {
    this.retryAction = null;
    this.cancelFragmentRequests();
    const preparation = this.preparation;
    this.preparation = null;
    if (!preparation) return Promise.resolve();
    preparation.controller.abort();
    // Activation itself is not aborted: its response identifies the exact backend
    // generation to stop. Cleanup stays ordered before the next activation.
    const cleanup = activationQueue.then(async () => {
      if (preparation.activated) await api.cancelModelLoad(preparation.activated);
    });
    activationQueue = cleanup.catch(() => {});
    return cleanup;
  }

  async fragments(modelHash: string): Promise<ArrayBuffer | null> {
    return api.getFragments(modelHash, this.fragmentRequests.signal);
  }

  cacheFragments(modelHash: string, fragments: Uint8Array, isCurrent: () => boolean) {
    void api.putFragments(modelHash, fragments, this.fragmentRequests.signal).catch((error) => {
      if (isCurrent()) console.warn(`Fragments cache: ${this.errorText(error)}`);
    });
  }

  async publishSelection(selection: ViewerSelection) {
    try {
      await api.setSelection(createSelectionPayload(selection));
    } catch (error) {
      console.warn(`Selection bridge: ${this.errorText(error)}`);
    }
  }

  async clearSelection(isCurrent: () => boolean = () => true) {
    try {
      await api.clearSelection();
    } catch (error) {
      if (isCurrent()) console.warn(`Selection bridge: ${this.errorText(error)}`);
    }
  }

  async prepareModel(
    file: File,
    modelHash: string,
    loadSequence: number,
    assertCurrent: () => void,
  ) {
    const preparation = { controller: new AbortController(), activated: undefined as ActivateModelResponse | undefined };
    this.preparation = preparation;
    const { signal } = preparation.controller;
    const check = () => {
      if (signal.aborted) throw new LoadCancelledError();
      assertCurrent();
    };
    const publish = (
      progress: Omit<BridgeProgress, "loadSequence" | "modelHash">,
    ) => this.callbacks.onProgress({ ...progress, loadSequence, modelHash });
    try {
      // Upload only stores bytes. Only a still-current request can activate them.
      const activation = activationQueue.then(async () => {
        check();
        publish({ stage: "activating", detail: file.name });
        try {
          preparation.activated = await api.activateModel(modelHash);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
        check();
        if (!preparation.activated) {
          publish({ stage: "uploading", progress: 0, detail: file.name });
          const uploaded = await api.uploadModel(file, (progress) => {
            try {
              check();
              publish({ stage: "uploading", progress, detail: file.name });
            } catch {
              // A newer model load owns progress now.
            }
          }, signal);
          check();
          if (uploaded.modelHash !== modelHash) throw new Error("Backend model hash does not match the local file");
          publish({ stage: "activating", detail: file.name });
          preparation.activated = await api.activateModel(modelHash);
          check();
        }
      });
      activationQueue = activation.catch(() => {});
      await activation;
      check();
      let latestAttempt: string | null = null;
      let latestSemantic: BridgeProgress["semantic"] = null;
      const checkWatch = (watchSignal: AbortSignal) => {
        if (watchSignal.aborted || preparation !== this.preparation) throw new LoadCancelledError();
        assertCurrent();
      };
      const readRuntime = async (watchSignal: AbortSignal) => {
        const runtime = await api.runtime(AbortSignal.any([watchSignal, AbortSignal.timeout(10000)]));
        checkWatch(watchSignal);
        if (!runtime.hasActiveModel || runtime.activeModelHash !== modelHash) throw new Error("Backend active model changed during semantic preparation");
        latestSemantic = runtime.semanticProgress;
        latestAttempt = latestSemantic?.attemptId ?? null;
        return runtime;
      };
      const watchError = (error: unknown, watchSignal: AbortSignal) => {
        if (!watchSignal.aborted && preparation === this.preparation && !isLoadCancelledError(error)) {
          publish({ stage: "error", detail: this.errorText(error), semantic: latestSemantic, canRetry: true });
        }
      };
      const watch = async (watchSignal: AbortSignal) => {
        while (true) {
          const runtime = await readRuntime(watchSignal);
          if (runtime.prepareError || runtime.coldIndexStatus === "error") throw new Error(runtime.prepareError ?? runtime.coldIndexError ?? "Detailed semantic indexing failed");
          if (runtime.hotIndexStatus === "ready" && runtime.coldIndexStatus === "ready") {
            publish({ stage: "ready", detail: file.name, semantic: latestSemantic, canRetry: false });
            return;
          }
          publish({ stage: latestSemantic?.stalled ? "stalled" : runtime.hotIndexStatus === "ready" ? "indexing_cold" : "indexing_hot",
            detail: file.name, semantic: latestSemantic, canRetry: Boolean(latestSemantic?.stalled),
            progress: latestSemantic?.total ? latestSemantic.completed / latestSemantic.total : undefined });
          await wait(1000);
          if (watchSignal.aborted) throw new LoadCancelledError();
        }
      };
      const retry = async () => {
        if (!preparation.activated || preparation !== this.preparation) return;
        this.retryAction = null;
        preparation.controller.abort();
        preparation.controller = new AbortController();
        const retrySignal = preparation.controller.signal;
        publish({ stage: "activating", detail: file.name, canRetry: false });
        const action = activationQueue.then(async () => {
          await readRuntime(retrySignal);
          // A transport failure only needs monitoring to resume. Restart the
          // worker only when the current backend attempt is actually retryable.
          if (latestAttempt && (latestSemantic?.stalled || latestSemantic?.status === "error")) {
            checkWatch(retrySignal);
            await api.retrySemantic(preparation.activated!, latestAttempt);
          }
        });
        activationQueue = action.catch(() => {});
        try {
          await action;
          checkWatch(retrySignal);
          this.retryAction = retry;
          void watch(retrySignal).catch(error => watchError(error, retrySignal));
        } catch (error) {
          if (!retrySignal.aborted && !isLoadCancelledError(error)) {
            this.retryAction = retry;
            watchError(error, retrySignal);
          }
        }
      };
      this.retryAction = retry;
      try { await watch(signal); }
      catch (error) { watchError(error, signal); }

    } catch (error) {
      if (!signal.aborted && !isLoadCancelledError(error)) {
        publish({ stage: "error", detail: this.errorText(error) });
      }
    }
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
