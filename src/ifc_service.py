"""Recovered IFC service for IFC Viewer 0.4.0.

The implementation covers model registration and activation, cache retention,
live-model lifecycle, unit and quantity normalization, semantic indexing, and
public element extraction with optional geometry.
"""

from __future__ import annotations

import io
import os
import shutil
import threading
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock, Thread
from time import monotonic, monotonic_ns
from typing import Any, BinaryIO

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.shape
import ifcopenshell.util.unit
import numpy as np

import index_builder
import model_index
from content_hash import copy_and_hash, sha256_file

CACHE_DIR = Path(
    os.environ.get("IFC_MODEL_CACHE_DIR") or Path(__file__).parent / ".model_cache"
)
LIVE_MODEL_MAX_BYTES = int(os.environ.get("IFC_LIVE_MODEL_MAX_BYTES") or 268_435_456)
LIVE_MODEL_IDLE_SECONDS = float(os.environ.get("IFC_LIVE_MODEL_IDLE_SECONDS") or 600.0)


def _cache_keep_models(raw: str | None) -> int:
    return max(1, int(raw or 3))


CACHE_KEEP_MODELS = _cache_keep_models(os.environ.get("IFC_CACHE_KEEP_MODELS"))


@dataclass
class ActiveModel:
    path: str
    contentHashSha256: str
    originalFilename: str | None
    sizeBytes: int
    loadedAt: str


class NoActiveModelError(Exception):
    """Raised when an operation requires an active model and none is registered."""


class HashMismatchError(Exception):
    """Raised when a registered file does not match its declared content hash."""


class IndexPreparingError(Exception):
    """Raised while the active model's semantic index is still being prepared."""


class _PrepareState:
    def __init__(self) -> None:
        self._lock = Lock()
        self._hashes = set()
        self._last_error = None
        self._errors: dict[str, str] = {}

    def begin(self, model_hash: str) -> bool:
        with self._lock:
            if model_hash in self._hashes:
                return False
            self._hashes.add(model_hash)
            self._last_error = None
            self._errors.pop(model_hash, None)
            return True

    def end(self, model_hash: str, error: str | None = None) -> None:
        with self._lock:
            self._hashes.discard(model_hash)
            if error is not None:
                self._last_error = error
                self._errors[model_hash] = error
            else:
                self._errors.pop(model_hash, None)

    def is_preparing(self, model_hash: str) -> bool:
        with self._lock:
            return model_hash in self._hashes

    def last_error(self) -> str | None:
        with self._lock:
            return self._last_error

    def error_for(self, model_hash: str) -> str | None:
        with self._lock:
            return self._errors.get(model_hash)

    def clear_error(self, model_hash: str) -> None:
        with self._lock:
            self._errors.pop(model_hash, None)


_prepare = _PrepareState()


class _ActiveModelState:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active = None
        self._ifc_file = None
        self._ifc_hash = None
        self._last_used = 0.0

    def set(self, model: ActiveModel, ifc_file=None) -> None:
        with self._lock:
            if self._ifc_hash != model.contentHashSha256:
                self._ifc_file = None
                self._ifc_hash = None
            self._active = model
            if ifc_file is not None:
                self._ifc_file = ifc_file
                self._ifc_hash = model.contentHashSha256
                self._last_used = monotonic()

    def get(self) -> ActiveModel:
        with self._lock:
            if self._active is None:
                raise NoActiveModelError("no active model")
            return self._active

    def get_or_none(self) -> ActiveModel | None:
        with self._lock:
            return self._active

    def get_open_file(self):
        with self._lock:
            if self._active is None:
                raise NoActiveModelError("no active model")
            if (
                self._ifc_file is None
                or self._ifc_hash != self._active.contentHashSha256
            ):
                self._ifc_file = ifcopenshell.open(model_source_path(self._active))
                self._ifc_hash = self._active.contentHashSha256
            self._last_used = monotonic()
            return self._ifc_file

    def is_open(self) -> bool:
        with self._lock:
            return self._ifc_file is not None and self._ifc_hash == (
                self._active.contentHashSha256 if self._active else None
            )

    def release_model(self, min_idle_seconds: float) -> bool:
        with self._lock:
            if self._ifc_file is None:
                return False
            if (
                min_idle_seconds > 0.0
                and monotonic() - self._last_used < min_idle_seconds
            ):
                return False
            self._ifc_file = None
            self._ifc_hash = None
            return True

    def clear(self) -> None:
        with self._lock:
            self._active = None
            self._ifc_file = None
            self._ifc_hash = None

    def clear_if(self, model_hash: str) -> None:
        with self._lock:
            if (
                self._active is not None
                and self._active.contentHashSha256 == model_hash
            ):
                self._active = None
                self._ifc_file = None
                self._ifc_hash = None


_state = _ActiveModelState()


def now_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _ensure_cache_dir() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def model_source_path(model: ActiveModel) -> str:
    store = index_builder.store_path_for(CACHE_DIR, model.contentHashSha256)
    return str(store) if index_builder.store_is_usable(store) else model.path


_BUNDLE_PATTERNS = ("*.ifc", "*.frag", "*.sqlite", "*.rdb")
_PARTIAL_PATTERNS = (
    "*.ifc.partial",
    "*.frag.partial",
    "*.sqlite.partial",
    "*.rdb.partial",
)


def _remove_cache_path(path: Path) -> None:
    try:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink()
    except FileNotFoundError:
        return
    except Exception:
        return


def _enforce_cache_retention(active_hash: str) -> None:
    _ensure_cache_dir()
    for pattern in _PARTIAL_PATTERNS:
        for path in CACHE_DIR.glob(pattern):
            if path.name.split(".", 1)[0] != active_hash:
                _remove_cache_path(path)

    bundles: dict[str, list[Path]] = {}
    for pattern in _BUNDLE_PATTERNS:
        for path in CACHE_DIR.glob(pattern):
            bundles.setdefault(path.stem, []).append(path)

    for path in bundles.get(active_hash, []):
        try:
            os.utime(path)
        except Exception:
            continue

    def recency(model_hash: str) -> float:
        times = []
        for path in bundles[model_hash]:
            try:
                times.append(path.stat().st_mtime)
            except OSError:
                continue
        return max(times, default=0.0)

    others = sorted(
        (model_hash for model_hash in bundles if model_hash != active_hash),
        key=recency,
        reverse=True,
    )
    for model_hash in others[max(0, CACHE_KEEP_MODELS - 1) :]:
        for path in bundles[model_hash]:
            _remove_cache_path(path)


def _fragments_cache_path(model_hash: str) -> Path:
    return CACHE_DIR / f"{model_hash}.frag"


def cached_fragments_file(model_hash: str) -> Path:
    path = _fragments_cache_path(model_hash)
    if not path.exists():
        raise FileNotFoundError(f"no cached fragments for {model_hash}")
    return path


def cached_model_file(model_hash: str) -> Path:
    path = CACHE_DIR / f"{model_hash}.ifc"
    if not path.exists() or path.stat().st_size == 0:
        raise FileNotFoundError(f"no cached model for {model_hash}")
    return path


def store_cached_fragments_start(model_hash: str) -> Path:
    _ensure_cache_dir()
    return _fragments_cache_path(model_hash).with_suffix(".frag.partial")


def store_cached_fragments_commit(model_hash: str, staging: Path) -> int:
    size = staging.stat().st_size
    if size == 0:
        staging.unlink(missing_ok=True)
        raise ValueError("empty fragments body")
    target = _fragments_cache_path(model_hash)
    target.unlink(missing_ok=True)
    staging.rename(target)
    return size


def materialize_model_stream(
    reader: BinaryIO,
    original_filename: str | None,
    background: bool = False,
) -> dict:
    _ensure_cache_dir()
    staging = CACHE_DIR / (
        f"incoming-{threading.get_ident()}-{monotonic_ns()}.ifc.partial"
    )
    try:
        model_hash, size = copy_and_hash(reader, staging)
        if size == 0:
            raise ValueError("empty model body")
    except BaseException:
        staging.unlink(missing_ok=True)
        raise

    target = CACHE_DIR / f"{model_hash}.ifc"
    if target.exists() and target.stat().st_size == size:
        staging.unlink()
    else:
        target.unlink(missing_ok=True)
        staging.rename(target)
    _enforce_cache_retention(model_hash)
    model = ActiveModel(
        path=str(target),
        contentHashSha256=model_hash,
        originalFilename=original_filename,
        sizeBytes=size,
        loadedAt=now_utc(),
    )
    (_activate_in_background if background else _activate)(model)
    return {
        "path": model.path,
        "contentHashSha256": model.contentHashSha256,
        "originalFilename": model.originalFilename,
        "sizeBytes": model.sizeBytes,
        "loadedAt": model.loadedAt,
    }


def materialize_model_file(
    raw_bytes: bytes,
    original_filename: str | None,
    background: bool = False,
) -> dict:
    return materialize_model_stream(io.BytesIO(raw_bytes), original_filename, background)


def register_model(
    path: str,
    expected_hash: str,
    background: bool = False,
) -> dict:
    model_path = Path(path)
    if not model_path.exists():
        raise FileNotFoundError(f"model path not found: {path}")
    actual = sha256_file(model_path)
    if actual != expected_hash:
        raise HashMismatchError(
            f"hash mismatch for {path}: expected {expected_hash} got {actual}"
        )
    _enforce_cache_retention(actual)
    model = ActiveModel(
        path=str(model_path.resolve()),
        contentHashSha256=actual,
        originalFilename=model_path.name,
        sizeBytes=model_path.stat().st_size,
        loadedAt=now_utc(),
    )
    (_activate_in_background if background else _activate)(model)
    return asdict(model)


def _activate(model: ActiveModel) -> None:
    _state.set(model)
    target = model_index.index_path_for(CACHE_DIR, model.contentHashSha256)
    if model_index.is_usable(target):
        _prepare.clear_error(model.contentHashSha256)
        return
    if not _prepare.begin(model.contentHashSha256):
        raise IndexPreparingError(model.contentHashSha256)
    _run_build(model, target)


def _run_build(model: ActiveModel, target: Path) -> None:
    _ensure_cache_dir()
    try:
        index_builder.prepare_model(
            model.path, model.contentHashSha256, str(CACHE_DIR)
        )
        if not model_index.is_usable(target):
            raise RuntimeError(
                f"index build produced no usable index for {model.contentHashSha256}"
            )
    except Exception as error:
        _prepare.end(model.contentHashSha256, error=str(error))
        _state.clear_if(model.contentHashSha256)
        raise
    _prepare.end(model.contentHashSha256, None)


def _activate_in_background(model: ActiveModel) -> None:
    _state.set(model)
    target = model_index.index_path_for(CACHE_DIR, model.contentHashSha256)
    if model_index.is_usable(target):
        _prepare.clear_error(model.contentHashSha256)
        return
    if not _prepare.begin(model.contentHashSha256):
        return

    def run() -> None:
        try:
            _run_build(model, target)
        except Exception as error:
            print(
                f"ERROR background index build {model.contentHashSha256[:12]}: {error}"
            )

    Thread(target=run, name="ifc-index-prepare", daemon=True).start()


def active_index() -> model_index.ModelIndex:
    model = _state.get()
    if _prepare.is_preparing(model.contentHashSha256):
        raise IndexPreparingError(model.contentHashSha256)
    target = model_index.index_path_for(CACHE_DIR, model.contentHashSha256)
    if not model_index.is_usable(target):
        _activate(model)
    return model_index.ModelIndex(target)


def get_active_model_info() -> dict:
    return asdict(_state.get())


def open_active_model():
    model = _state.get()
    if _prepare.is_preparing(model.contentHashSha256):
        raise IndexPreparingError(model.contentHashSha256)
    return _state.get_open_file()


def locate_live_element(ifc_file: Any, global_id: str):
    record = active_index().record_by_global_id(global_id)
    element = ifc_file.by_id(int(record["expressId"]))
    if getattr(element, "GlobalId", None) != global_id:
        raise LookupError(
            f"{global_id} is not express id {record['expressId']} in this model"
        )
    return element


def release_idle_model() -> bool:
    return _state.release_model(LIVE_MODEL_IDLE_SECONDS)


def live_model_status() -> dict:
    model = _state.get_or_none()
    return {
        "hasActiveModel": model is not None,
        "modelResident": _state.is_open(),
        "preparing": model is not None
        and _prepare.is_preparing(model.contentHashSha256),
        "prepareError": _prepare.error_for(model.contentHashSha256)
        if model is not None
        else None,
        "storeBacked": model is not None
        and index_builder.store_is_usable(
            index_builder.store_path_for(CACHE_DIR, model.contentHashSha256)
        ),
        "sizeBytes": model.sizeBytes if model else 0,
        "liveModelMaxBytes": LIVE_MODEL_MAX_BYTES,
        "idleSeconds": LIVE_MODEL_IDLE_SECONDS,
    }


def _lengths_to_m(values: Any, length_scale: float) -> list:
    return (np.asarray(values, dtype=float) * length_scale).tolist()


def _to_kilograms(mass_in_project_units: float, mass_scale: float) -> float:
    return mass_in_project_units * mass_scale / 1000.0


def _has_unit_type(ifc_file: Any, unit_type: str) -> bool:
    projects = ifc_file.by_type("IfcProject")
    if not projects or not projects[0].UnitsInContext:
        return False
    return any(
        getattr(unit, "UnitType", None) == unit_type
        for unit in projects[0].UnitsInContext.Units
    )


def _named_unit_scale_to_si(unit: Any) -> float | None:
    scale = 1.0
    current = unit
    while current.is_a("IfcConversionBasedUnit"):
        conversion_factor = current.ConversionFactor
        scale *= float(conversion_factor.ValueComponent.wrappedValue)
        current = conversion_factor.UnitComponent
    if not current.is_a("IfcSIUnit"):
        return None

    prefix_scale = ifcopenshell.util.unit.get_prefix_multiplier(current.Prefix)
    unit_name = str(current.Name or "")
    if "SQUARE" in unit_name:
        scale *= prefix_scale**2
    elif "CUBIC" in unit_name:
        scale *= prefix_scale**3
    else:
        scale *= prefix_scale
    return scale


def _project_unit_scale_to_si(
    ifc_file: Any, unit_type: str, length_scale: float
) -> float | None:
    project_unit = ifcopenshell.util.unit.get_project_unit(ifc_file, unit_type)
    if project_unit is not None:
        return _named_unit_scale_to_si(project_unit)
    if unit_type == "LENGTHUNIT":
        return length_scale
    if unit_type == "AREAUNIT":
        return length_scale**2
    if unit_type == "VOLUMEUNIT":
        return length_scale**3
    return None


@dataclass(frozen=True)
class ProjectUnits:
    length_scale: float
    has_mass_unit: bool
    mass_scale: float
    si_scale: dict[str, float | None]


def project_units(ifc_file: Any) -> ProjectUnits:
    length_scale = ifcopenshell.util.unit.calculate_unit_scale(ifc_file)
    return ProjectUnits(
        length_scale=length_scale,
        has_mass_unit=_has_unit_type(ifc_file, "MASSUNIT"),
        mass_scale=ifcopenshell.util.unit.calculate_unit_scale(ifc_file, "MASSUNIT"),
        si_scale={
            unit_type: _project_unit_scale_to_si(ifc_file, unit_type, length_scale)
            for unit_type in ("LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT", "MASSUNIT")
        },
    )


def _quantity_value_field(quantity: Any) -> tuple[str, str] | None:
    if quantity.is_a("IfcQuantityLength"):
        return "LengthValue", "LENGTHUNIT"
    if quantity.is_a("IfcQuantityArea"):
        return "AreaValue", "AREAUNIT"
    if quantity.is_a("IfcQuantityVolume"):
        return "VolumeValue", "VOLUMEUNIT"
    if quantity.is_a("IfcQuantityWeight"):
        return "WeightValue", "MASSUNIT"
    return None


def _quantity_value_to_display_unit(
    value: float,
    quantity: Any,
    units: ProjectUnits,
    unit_type: str,
) -> tuple[float, str] | None:
    explicit_unit = getattr(quantity, "Unit", None)
    scale = (
        _named_unit_scale_to_si(explicit_unit)
        if explicit_unit is not None
        else units.si_scale[unit_type]
    )
    if scale is None:
        return None
    if unit_type == "MASSUNIT":
        return _to_kilograms(value, scale), "mass"
    if unit_type == "AREAUNIT":
        return value * scale, "area"
    if unit_type == "VOLUMEUNIT":
        return value * scale, "volume"
    return value * scale, "length"


def _normalise_quantities(
    element: Any,
    quantities: dict,
    units: ProjectUnits,
) -> tuple[dict, set[str]]:
    normalised = {set_name: dict(qto) for set_name, qto in quantities.items()}
    resolved_unit_kinds = set()

    for relation in getattr(element, "IsDefinedBy", []) or []:
        if not relation.is_a("IfcRelDefinesByProperties"):
            continue
        qset = relation.RelatingPropertyDefinition
        if qset is None or not qset.is_a("IfcElementQuantity"):
            continue
        set_name = qset.Name or "Quantities"
        target = normalised.setdefault(set_name, {})
        for quantity in qset.Quantities or []:
            field = _quantity_value_field(quantity)
            if field is None:
                continue
            quantity_name = quantity.Name
            if not quantity_name:
                continue
            value_field, unit_type = field
            raw_value = getattr(quantity, value_field, None)
            if not isinstance(raw_value, int | float):
                continue
            converted = _quantity_value_to_display_unit(
                float(raw_value), quantity, units, unit_type
            )
            if converted is None:
                continue
            target[quantity_name] = converted[0]
            resolved_unit_kinds.add(converted[1])
    return normalised, resolved_unit_kinds


def _find_quantity(quantities: dict, *names: str) -> float | None:
    for qto in quantities.values():
        for name in names:
            value = qto.get(name)
            if isinstance(value, int | float):
                return float(value)
    return None


def _has_authored_weight(quantities: dict) -> bool:
    weight_keys = ("NetWeight", "GrossWeight")
    return any(key in qto for qto in quantities.values() for key in weight_keys)


def _compute_mass_kg(
    element: Any,
    units: ProjectUnits,
    quantities: dict,
) -> float | None:
    if not units.has_mass_unit:
        return None
    density = ifcopenshell.util.element.get_element_mass_density(element)
    if density is None:
        return None
    volume = _find_quantity(quantities, "NetVolume", "GrossVolume")
    if volume is None:
        return None
    return _to_kilograms(density * volume, units.mass_scale)


def direct_children(entity: Any) -> list[Any]:
    children = []
    for relation in getattr(entity, "IsDecomposedBy", []) or []:
        children.extend(relation.RelatedObjects or [])
    for relation in getattr(entity, "ContainsElements", []) or []:
        children.extend(relation.RelatedElements or [])
    for relation in getattr(entity, "IsNestedBy", []) or []:
        children.extend(relation.RelatedObjects or [])
    for relation in getattr(entity, "HasOpenings", []) or []:
        children.append(relation.RelatedOpeningElement)
    for relation in getattr(entity, "HasFillings", []) or []:
        children.append(relation.RelatedBuildingElement)
    unique = {child.id(): child for child in children if child is not None}
    return sorted(
        unique.values(),
        key=lambda child: (
            child.is_a(),
            str(getattr(child, "Name", "") or ""),
            child.id(),
        ),
    )


def build_semantic_record(
    element: Any,
    ifc_file: Any,
    project_unit_state: ProjectUnits | None = None,
) -> dict:
    resolved_units = project_unit_state or project_units(ifc_file)
    properties = (
        ifcopenshell.util.element.get_psets(element, psets_only=True) or {}
    )
    quantities = (
        ifcopenshell.util.element.get_psets(element, qtos_only=True) or {}
    )
    global_id = getattr(element, "GlobalId", None)
    express_id = element.id()
    ifc_type = element.is_a()
    name = getattr(element, "Name", None)
    unit_record = {
        "lengthUnit": "m",
        "projectLengthUnitScaleToMeters": resolved_units.length_scale,
    }
    normalised_quantities, resolved_unit_kinds = _normalise_quantities(
        element, quantities, resolved_units
    )
    if "area" in resolved_unit_kinds:
        unit_record["areaUnit"] = "m2"
    if "volume" in resolved_unit_kinds:
        unit_record["volumeUnit"] = "m3"
    if "mass" in resolved_unit_kinds:
        unit_record["massUnit"] = "kg"

    if not _has_authored_weight(quantities):
        mass_kg = _compute_mass_kg(element, resolved_units, quantities)
        if mass_kg is not None:
            normalised_quantities = {
                **normalised_quantities,
                "Computed": {"Mass": mass_kg},
            }
            unit_record["massUnit"] = "kg"

    return {
        "globalId": global_id,
        "expressId": express_id,
        "ifcType": ifc_type,
        "name": name,
        "properties": properties,
        "quantities": normalised_quantities,
        "units": unit_record,
    }


def _build_geometry(element: Any, unit_scale: float) -> dict | None:
    try:
        settings = ifcopenshell.geom.settings()
        settings.set("convert-back-units", True)
        shape = ifcopenshell.geom.create_shape(settings, element)
        geometry = shape.geometry
        verts_raw = list(geometry.verts)
        faces = list(geometry.faces)
        verts = _lengths_to_m(verts_raw, unit_scale)
        grouped = ifcopenshell.util.shape.get_vertices(geometry)
        minimum, maximum = ifcopenshell.util.shape.get_bbox(grouped)
        bbox = [
            _lengths_to_m(minimum, unit_scale),
            _lengths_to_m(maximum, unit_scale),
        ]
        matrix_flat = list(shape.transformation.matrix)
        matrix = np.array(matrix_flat, dtype=float).reshape((4, 4), order="F").tolist()
        return {
            "verts": verts,
            "faces": faces,
            "matrix": matrix,
            "bbox": bbox,
        }
    except Exception:
        return None


def _should_open_for_geometry() -> bool:
    if _state.is_open():
        return True
    model = _state.get_or_none()
    if model is None:
        return False
    if index_builder.store_is_usable(
        index_builder.store_path_for(CACHE_DIR, model.contentHashSha256)
    ):
        return True
    return model.sizeBytes <= LIVE_MODEL_MAX_BYTES


def _with_geometry(record: dict, locate) -> dict:
    if not _should_open_for_geometry():
        return {
            **record,
            "geometry": None,
            "geometryStatus": "not_loaded_large_model",
        }
    ifc_file = open_active_model()
    try:
        element = locate(ifc_file)
    except (RuntimeError, LookupError):
        return {**record, "geometry": None, "geometryStatus": "unavailable"}
    unit_scale = ifcopenshell.util.unit.calculate_unit_scale(ifc_file)
    geometry = _build_geometry(element, unit_scale)
    return {
        **record,
        "geometry": geometry,
        "geometryStatus": "included" if geometry is not None else "unavailable",
    }


def extract_element(global_id: str) -> dict:
    record = active_index().record_by_global_id(global_id)
    express_id = int(record["expressId"])
    return _with_geometry(record, lambda ifc_file: ifc_file.by_id(express_id))


def extract_element_by_express_id(express_id: int) -> dict:
    record = active_index().record_by_express_id(express_id)
    return _with_geometry(record, lambda ifc_file: ifc_file.by_id(express_id))
