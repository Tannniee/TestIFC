/// <reference lib="webworker" />

import { IfcImporter } from "@thatopen/fragments";
import {
  configureFragmentImporter,
  type FragmentMetadataProfile,
} from "../lib/fragment-profile";

interface ConvertRequest {
  id: number;
  bytes: ArrayBuffer;
  profile: FragmentMetadataProfile;
}

function createImporter(profile: FragmentMetadataProfile): IfcImporter {
  const importer = new IfcImporter();
  configureFragmentImporter(importer, profile);
  importer.wasm = {
    path: new URL("/vendor/web-ifc/", self.location.href).href,
    absolute: true,
  };
  importer.webIfcSettings = { COORDINATE_TO_ORIGIN: true };
  return importer;
}

self.onmessage = async (event: MessageEvent<ConvertRequest>) => {
  const { id, bytes, profile } = event.data;
  try {
    const importer = createImporter(profile);
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
