export const MAX_IFC_BYTES = 1024 * 1024 * 1024;

export class IfcFileTooLargeError extends Error {
  readonly sizeBytes: number;

  constructor(sizeBytes: number) {
    super("Không thể mở file IFC lớn hơn 1 GiB vì WebIFC không hỗ trợ ổn định kích thước này.");
    this.name = "IfcFileTooLargeError";
    this.sizeBytes = sizeBytes;
  }
}

export function requireSupportedIfcSize(sizeBytes: number): void {
  if (sizeBytes > MAX_IFC_BYTES) throw new IfcFileTooLargeError(sizeBytes);
}
