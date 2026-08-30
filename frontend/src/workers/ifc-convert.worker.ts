/// <reference lib="webworker" />

import { IfcImporter } from "@thatopen/fragments";

interface ConvertRequest {
  id: number;
  bytes: ArrayBuffer;
}

const importer = new IfcImporter();
importer.addAllAttributes();
importer.addAllRelations();
importer.wasm = {
  path: new URL("/vendor/web-ifc/", self.location.href).href,
  absolute: true,
};
importer.webIfcSettings = { COORDINATE_TO_ORIGIN: true };

self.onmessage = async (event: MessageEvent<ConvertRequest>) => {
  const { id, bytes } = event.data;
  try {
    const fragments = await importer.process({
      bytes: new Uint8Array(bytes),
      raw: false,
      progressCallback(progress, data) {
        self.postMessage({ type: "progress", id, progress, detail: data });
      },
    });
    self.postMessage(
      { type: "done", id, fragments },
      { transfer: [fragments.buffer] },
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
