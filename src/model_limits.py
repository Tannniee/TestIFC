"""Hard model-size limits shared by model ingestion paths."""

from __future__ import annotations


MAX_IFC_BYTES = 2_000_000_000
MAX_IFC_LABEL = "2 GB"
ONE_GIB_BYTES = 1024 * 1024 * 1024


class ModelTooLargeError(ValueError):
    def __init__(self, size_bytes: int | None = None, *, native_required: bool = False):
        self.size_bytes = size_bytes
        super().__init__("large_model_requires_engine_v2" if native_required else "ifc_file_exceeds_2_gb_limit")


def require_supported_ifc_size(size_bytes: int) -> None:
    if size_bytes > MAX_IFC_BYTES:
        raise ModelTooLargeError(size_bytes)


def require_legacy_ifc_size(size_bytes: int) -> None:
    require_supported_ifc_size(size_bytes)
    if size_bytes > ONE_GIB_BYTES:
        raise ModelTooLargeError(size_bytes, native_required=True)
