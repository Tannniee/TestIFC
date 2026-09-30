import { LoadCancelledError } from "./viewer-contracts";
import type { FragmentMetadataProfile } from "./fragment-profile";
import type { ProgressData } from "@thatopen/fragments";

interface WorkerProgressMessage {
  type: "progress";
  id: number;
  progress: number;
  detail?: ProgressData;
}

interface WorkerDoneMessage {
  type: "done";
  id: number;
  fragments: Uint8Array;
}

interface WorkerErrorMessage {
  type: "error";
  id: number;
  message: string;
}

type WorkerMessage = WorkerProgressMessage | WorkerDoneMessage | WorkerErrorMessage;

export class IfcConverter {
  private worker: Worker | null = null;
  private disposed = false;
  private nextId = 1;
  private pending: {
    id: number;
    resolve(value: Uint8Array): void;
    reject(reason: unknown): void;
    onProgress(progress: number, detail?: ProgressData): void;
  } | null = null;

  constructor(private readonly profile: FragmentMetadataProfile) {}

  convert(bytes: ArrayBuffer, onProgress: (progress: number, detail?: ProgressData) => void): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new LoadCancelledError());
    this.cancel();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, onProgress };
      try {
        this.startWorker();
        this.worker!.postMessage({ id, bytes, profile: this.profile }, [bytes]);
      } catch (error) {
        this.pending = null;
        this.stopWorker();
        reject(error);
      }
    });
  }

  cancel() {
    this.pending?.reject(new LoadCancelledError());
    this.pending = null;
    this.stopWorker();
  }

  dispose() {
    this.disposed = true;
    this.pending?.reject(new LoadCancelledError());
    this.pending = null;
    this.stopWorker();
  }

  private startWorker() {
    if (this.disposed) return;
    this.worker = new Worker(new URL("../workers/ifc-convert.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onWorkerError);
    this.worker.addEventListener("messageerror", this.onMessageError);
  }

  private readonly onMessage = (event: MessageEvent<WorkerMessage>) => {
    const pending = this.pending;
    if (!pending || event.data.id !== pending.id) return;
    if (event.data.type === "progress") {
      pending.onProgress(event.data.progress, event.data.detail);
      return;
    }
    this.pending = null;
    this.stopWorker();
    if (event.data.type === "done") pending.resolve(event.data.fragments);
    else pending.reject(new Error(event.data.message));
  };

  private readonly onWorkerError = (event: ErrorEvent) => {
    this.rejectPending(new Error(event.message || "IFC conversion worker failed"));
    this.stopWorker();
  };

  private readonly onMessageError = () => {
    this.rejectPending(new Error("IFC conversion worker returned unreadable data"));
    this.stopWorker();
  };

  private rejectPending(error: Error) {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  private stopWorker() {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.removeEventListener("message", this.onMessage);
    worker.removeEventListener("error", this.onWorkerError);
    worker.removeEventListener("messageerror", this.onMessageError);
    worker.terminate();
  }
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
