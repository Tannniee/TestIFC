"""Hard model-size limits shared by model ingestion paths."""

from __future__ import annotations


MAX_IFC_BYTES = 1024 * 1024 * 1024
MAX_IFC_LABEL = "1 GiB"


class ModelTooLargeError(ValueError):
    def __init__(self, size_bytes: int | None = None):
        self.size_bytes = size_bytes
        super().__init__("ifc_file_exceeds_1_gib_limit")


def require_supported_ifc_size(size_bytes: int) -> None:
    if size_bytes > MAX_IFC_BYTES:
        raise ModelTooLargeError(size_bytes)
