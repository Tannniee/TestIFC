import { LoadCancelledError } from "./viewer-contracts";

export function readModelFile(file: File, signal: AbortSignal, onProgress: (value: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new LoadCancelledError()); return; }
    const reader = new FileReader();
    const abort = () => reader.abort();
    const clean = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    reader.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    reader.onload = () => { clean(); resolve(reader.result as ArrayBuffer); };
    reader.onerror = () => { clean(); reject(reader.error ?? new Error("Unable to read IFC file")); };
    reader.onabort = () => { clean(); reject(new LoadCancelledError()); };
    reader.readAsArrayBuffer(file);
  });
}
