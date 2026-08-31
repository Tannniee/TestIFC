import { api, isAuthorizationError } from "./api";
import { isLoadCancelledError, type BridgeProgress, type ViewerSelection } from "./viewer-contracts";
import { createSelectionPayload } from "./viewer-selection";

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export interface ViewerBridgeCallbacks {
  onProgress(progress: BridgeProgress): void;
  onAuthorizationRequired(error: unknown): void;
}

export class ViewerBridge {
  constructor(private readonly callbacks: ViewerBridgeCallbacks) {}

  async fragments(modelHash: string): Promise<ArrayBuffer | null> {
    try {
      return await api.getFragments(modelHash);
    } catch (error) {
      if (isAuthorizationError(error)) this.callbacks.onAuthorizationRequired(error);
      throw error;
    }
  }

  isAuthorizationFailure(error: unknown) {
    return isAuthorizationError(error);
  }

  cacheFragments(modelHash: string, fragments: Uint8Array, isCurrent: () => boolean) {
    void api.putFragments(modelHash, fragments).catch((error) => {
      if (isCurrent()) {
        this.callbacks.onProgress({ stage: "error", detail: `Fragments cache: ${this.errorText(error)}` });
      }
    });
  }

  async publishSelection(selection: ViewerSelection) {
    try {
      await api.setSelection(createSelectionPayload(selection));
      this.callbacks.onProgress({ stage: "ready", detail: selection.name ?? selection.ifcType ?? undefined });
    } catch (error) {
      if (isAuthorizationError(error)) this.callbacks.onAuthorizationRequired(error);
      this.callbacks.onProgress({ stage: "error", detail: this.errorText(error) });
    }
  }

  async clearSelection(isCurrent: () => boolean = () => true) {
    try {
      await api.clearSelection();
      if (isCurrent()) this.callbacks.onProgress({ stage: "cleared" });
    } catch (error) {
      if (isAuthorizationError(error)) this.callbacks.onAuthorizationRequired(error);
      this.callbacks.onProgress({ stage: "error", detail: this.errorText(error) });
    }
  }

  async prepareModel(file: File, modelHash: string, assertCurrent: () => void) {
    try {
      this.callbacks.onProgress({ stage: "activating", detail: file.name });
      const activated = await api.tryActivateModel(modelHash);
      assertCurrent();
      if (!activated) {
        this.callbacks.onProgress({ stage: "uploading", progress: 0, detail: file.name });
        const uploaded = await api.uploadModel(file, (progress) => {
          try {
            assertCurrent();
            this.callbacks.onProgress({ stage: "uploading", progress, detail: file.name });
          } catch {
            // A newer model load owns progress now.
          }
        });
        assertCurrent();
        if (uploaded.modelHash !== modelHash) throw new Error("Backend model hash does not match the local file");
      }
      while (true) {
        const runtime = await api.runtime();
        assertCurrent();
        if (runtime.prepareError) throw new Error(runtime.prepareError);
        if (runtime.hasActiveModel && !runtime.preparing) {
          this.callbacks.onProgress({ stage: "ready", detail: file.name });
          return;
        }
        this.callbacks.onProgress({ stage: "preparing", detail: file.name });
        await wait(2000);
        assertCurrent();
      }
    } catch (error) {
      if (isAuthorizationError(error)) this.callbacks.onAuthorizationRequired(error);
      if (!isLoadCancelledError(error)) this.callbacks.onProgress({ stage: "error", detail: this.errorText(error) });
    }
  }

  reportCacheError(error: unknown) {
    this.callbacks.onProgress({ stage: "error", detail: `Fragments cache: ${this.errorText(error)}` });
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
