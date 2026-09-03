/** A recoverable source problem, distinct from network/INDEX failures. */
export class ModelSourceError extends Error {
  constructor(readonly reason: "unavailable" | "changed", options?: ErrorOptions) {
    super(reason === "changed"
      ? "IFC nguồn đã thay đổi. Chọn lại file: cùng nội dung sẽ giữ các View, nội dung mới sẽ mở document mới."
      : "Không đọc được IFC nguồn. Hãy chọn lại file để khôi phục document và các View.", options);
    this.name = "ModelSourceError";
  }
}
