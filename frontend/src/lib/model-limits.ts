export const MAX_IFC_BYTES = 2_000_000_000;

export class IfcFileTooLargeError extends Error {
  readonly sizeBytes: number;

  constructor(sizeBytes: number) {
    super("Engine V2 hiện hỗ trợ file IFC tối đa 2 GB.");
    this.name = "IfcFileTooLargeError";
    this.sizeBytes = sizeBytes;
  }
}

export function requireSupportedIfcSize(sizeBytes: number): void {
  if (sizeBytes > MAX_IFC_BYTES) throw new IfcFileTooLargeError(sizeBytes);
}
