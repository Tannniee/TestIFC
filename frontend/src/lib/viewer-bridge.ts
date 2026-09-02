import { api } from "./api";
import { isLoadCancelledError, type BridgeProgress, type ViewerSelection } from "./viewer-contracts";
import { createSelectionPayload } from "./viewer-selection";

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
// Preserve write ordering across viewer remounts in the same window as well.
let activationQueue: Promise<void> = Promise.resolve();

export interface ViewerBridgeCallbacks {
  onProgress(progress: BridgeProgress): void;
}

export class ViewerBridge {
  private fragmentRequests = new AbortController();

  constructor(private readonly callbacks: ViewerBridgeCallbacks) {}

  cancelFragmentRequests() {
    this.fragmentRequests.abort();
    this.fragmentRequests = new AbortController();
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
    const publish = (
      progress: Omit<BridgeProgress, "loadSequence" | "modelHash">,
    ) => this.callbacks.onProgress({ ...progress, loadSequence, modelHash });
    try {
      // An HTTP abort cannot undo server-side activation. Serialize these writes
      // so an older upload can never activate after the newest model.
      const activation = activationQueue.then(async () => {
        assertCurrent();
        publish({ stage: "activating", detail: file.name });
        const activated = await api.tryActivateModel(modelHash);
        assertCurrent();
        if (!activated) {
          publish({ stage: "uploading", progress: 0, detail: file.name });
          const uploaded = await api.uploadModel(file, (progress) => {
            try {
              assertCurrent();
              publish({ stage: "uploading", progress, detail: file.name });
            } catch {
              // A newer model load owns progress now.
            }
          });
          assertCurrent();
          if (uploaded.modelHash !== modelHash) throw new Error("Backend model hash does not match the local file");
        }
      });
      activationQueue = activation.catch(() => {});
      await activation;
      assertCurrent();
      while (true) {
        const runtime = await api.runtime();
        assertCurrent();
        if (runtime.prepareError) throw new Error(runtime.prepareError);
        if (runtime.coldIndexStatus === "error") {
          throw new Error(runtime.coldIndexError ?? "Detailed semantic indexing failed");
        }
        if (runtime.hasActiveModel && runtime.activeModelHash !== modelHash) {
          throw new Error("Backend active model changed during semantic preparation");
        }
        if (runtime.hotIndexStatus === "ready") {
          if (runtime.coldIndexStatus === "indexing") {
            publish({ stage: "indexing_cold", detail: file.name });
            await wait(2000);
            assertCurrent();
            continue;
          }
          publish({ stage: "ready", detail: file.name });
          return;
        }
        publish({ stage: "indexing_hot", detail: file.name });
        await wait(2000);
        assertCurrent();
      }
    } catch (error) {
      if (!isLoadCancelledError(error)) {
        publish({ stage: "error", detail: this.errorText(error) });
      }
    }
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
