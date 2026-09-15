import assert from "node:assert/strict";
import test from "node:test";

import {
  IfcFileTooLargeError,
  MAX_IFC_BYTES,
  requireSupportedIfcSize,
} from "../src/lib/model-limits.ts";


test("IFC size limit allows exactly 1 GiB and rejects the next byte", () => {
  assert.doesNotThrow(() => requireSupportedIfcSize(MAX_IFC_BYTES));
  assert.throws(
    () => requireSupportedIfcSize(MAX_IFC_BYTES + 1),
    error => error instanceof IfcFileTooLargeError
      && error.sizeBytes === MAX_IFC_BYTES + 1
      && error.message.includes("WebIFC"),
  );
});
