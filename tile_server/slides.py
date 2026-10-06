"""Open a whole-slide image with kfbslide or OpenSlide and describe it.

.kfb / .kfbio files go through the pure-Python ``kfbslide`` package. Every
other format goes through OpenSlide. The adapter makes kfbslide failures look
like ``OpenSlideError`` so DeepZoom tile code can treat both the same way.

Label associated images are never read. They can carry patient identifiers.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import openslide
from openslide.deepzoom import DeepZoomGenerator
from PIL import Image

try:
    import kfbslide
except ImportError:  # kfbslide is optional until a .kfb file is opened
    kfbslide = None

KFB_EXTENSIONS = {".kfb", ".kfbio"}
OPENSLIDE_EXTENSIONS = {
    ".svs",
    ".tif",
    ".tiff",
    ".ndpi",
    ".scn",
    ".vms",
    ".vmu",
    ".bif",
    ".mrxs",
}
SUPPORTED_EXTENSIONS = KFB_EXTENSIONS | OPENSLIDE_EXTENSIONS

TILE_SIZE = 254
TILE_OVERLAP = 1
JPEG_QUALITY = 80

# Associated-image names that must never be decoded or returned.
_PRIVATE_ASSOCIATED = {"label"}


class SlideNotFound(Exception):
    """The requested slide is not inside a configured directory."""


class SlideOpenError(Exception):
    """The file exists but neither kfbslide nor OpenSlide could open it."""


class KfbAdapter:
    """Wrap a kfbslide handle so it quacks like openslide.OpenSlide.

    DeepZoom and the tile routes catch ``OpenSlideError``. kfbslide raises
    its own exceptions, and it has no ICC profile or OpenSlide tile cache.
    """

    def __init__(self, path):
        if kfbslide is None:
            raise openslide.OpenSlideError(
                "kfbslide is not installed; cannot open KFB slides"
            )
        try:
            self._s = kfbslide.OpenSlide(str(path))
        except Exception as exc:  # noqa: BLE001 - vendor reader raises broadly
            raise openslide.OpenSlideError(
                f"kfbslide cannot open {path}: {exc}"
            ) from exc

    def __getattr__(self, name):
        return getattr(self._s, name)

    def set_cache(self, cache):
        """OpenSlide's shared tile cache does not apply to kfbslide."""

    @property
    def color_profile(self):
        return None

    def read_region(self, location, level, size):
        try:
            return self._s.read_region(location, level, size)
        except Exception as exc:  # noqa: BLE001
            raise openslide.OpenSlideError(str(exc)) from exc

    def get_thumbnail(self, size):
        # kfbslide 0.3.4 ignores `size` when the file has no stored thumbnail
        # and returns the whole smallest pyramid level.
        try:
            image = self._s.get_thumbnail(size)
        except Exception as exc:  # noqa: BLE001
            raise openslide.OpenSlideError(str(exc)) from exc
        if image.width > size[0] or image.height > size[1]:
            image = image.copy()
            image.thumbnail(size, Image.LANCZOS)
        return image


def open_any(path):
    """Return an OpenSlide-like object for a .kfb or any OpenSlide format."""
    suffix = Path(path).suffix.lower()
    if suffix in KFB_EXTENSIONS:
        return KfbAdapter(path)
    try:
        return openslide.OpenSlide(str(path))
    except openslide.OpenSlideError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise openslide.OpenSlideError(str(exc)) from exc


def detect_format(path) -> str | None:
    suffix = Path(path).suffix.lower()
    if suffix in KFB_EXTENSIONS:
        return "kfbio" if kfbslide is not None else None
    try:
        return openslide.OpenSlide.detect_format(str(path))
    except Exception:  # noqa: BLE001
        return None


def _prop(slide, key: str):
    try:
        value = slide.properties.get(key)
    except Exception:  # noqa: BLE001
        return None
    if value is None:
        return None
    return str(value)


def _as_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _associated_names(slide) -> set[str]:
    try:
        return {str(name) for name in slide.associated_images.keys()}
    except Exception:  # noqa: BLE001
        return set()


def _jpeg_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.convert("RGB").save(buffer, "JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue()


@dataclass
class _Handle:
    slide: object
    dz: DeepZoomGenerator
    lock: threading.Lock
    path: Path


class SlideStore:
    """Cached, path-safe access to slide directories.

    ``roots`` maps a short public name (``library``, ``uploads``) to a
    directory. Callers address a file as ``(root, filename)`` and the
    filename must be a single path segment inside that directory.
    """

    def __init__(self, roots: dict[str, Path]):
        self.roots = {name: Path(path) for name, path in roots.items()}
        for directory in self.roots.values():
            directory.mkdir(parents=True, exist_ok=True)
        self._guard = threading.Lock()
        self._handles: dict[tuple[str, str], _Handle] = {}
        self._thumbnails: dict[tuple[str, float], bytes] = {}

    def resolve(self, root: str, filename: str) -> Path:
        directory = self.roots.get(root)
        if directory is None:
            raise SlideNotFound(f"Unknown slide collection '{root}'")
        if (
            not filename
            or filename != Path(filename).name
            or filename.startswith(".")
            or "\x00" in filename
        ):
            raise SlideNotFound("Invalid slide name")
        root_resolved = directory.resolve()
        candidate = (directory / filename).resolve()
        try:
            inside = Path(candidate).is_relative_to(root_resolved)
        except AttributeError:  # pragma: no cover - py3.8 and older
            inside = str(candidate).startswith(str(root_resolved) + "/")
        if not inside or candidate == root_resolved or not candidate.is_file():
            raise SlideNotFound("Slide not found")
        if candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise SlideNotFound("Unsupported slide format")
        return candidate

    def _open(self, root: str, filename: str) -> _Handle:
        key = (root, filename)
        with self._guard:
            handle = self._handles.get(key)
            if handle is not None:
                return handle
            path = self.resolve(root, filename)
            try:
                slide = open_any(path)
                dz = DeepZoomGenerator(
                    slide,
                    tile_size=TILE_SIZE,
                    overlap=TILE_OVERLAP,
                    limit_bounds=True,
                )
            except openslide.OpenSlideError as exc:
                raise SlideOpenError(str(exc)) from exc
            except Exception as exc:  # noqa: BLE001
                raise SlideOpenError(f"Cannot open {filename}: {exc}") from exc
            handle = _Handle(
                slide=slide,
                dz=dz,
                lock=threading.Lock(),
                path=path,
            )
            self._handles[key] = handle
            return handle

    def describe(self, root: str, filename: str) -> dict:
        path = self.resolve(root, filename)
        handle = self._open(root, filename)
        slide = handle.slide
        dz = handle.dz
        width, height = slide.dimensions
        levels = []
        for index, (dims, downsample) in enumerate(
            zip(slide.level_dimensions, slide.level_downsamples)
        ):
            levels.append(
                {
                    "level": index,
                    "width": int(dims[0]),
                    "height": int(dims[1]),
                    "downsample": float(downsample),
                }
            )
        mpp_x = _as_float(_prop(slide, "openslide.mpp-x"))
        mpp_y = _as_float(_prop(slide, "openslide.mpp-y"))
        objective = _as_float(_prop(slide, "openslide.objective-power"))
        if objective is None:
            objective = _as_float(_prop(slide, "aperio.AppMag"))
        names = _associated_names(slide)
        # Only advertise the macro. The label image stays out of the payload.
        vendor = _prop(slide, "openslide.vendor")
        fmt = detect_format(path) or path.suffix.lower().lstrip(".")
        return {
            "id": f"{root}/{filename}",
            "root": root,
            "filename": filename,
            "name": path.stem,
            "format": fmt,
            "vendor": vendor,
            "width": int(width),
            "height": int(height),
            "level_count": int(slide.level_count),
            "levels": levels,
            "dzi_levels": int(dz.level_count),
            "mpp_x": mpp_x,
            "mpp_y": mpp_y,
            "objective_power": objective,
            "tile_size": TILE_SIZE,
            "overlap": TILE_OVERLAP,
            "has_macro": "macro" in names,
        }

    def list_slides(self, only_root: str | None = None) -> list[dict]:
        found = []
        roots = self.roots.items()
        if only_root is not None:
            if only_root not in self.roots:
                return []
            roots = [(only_root, self.roots[only_root])]
        for root, directory in roots:
            if not directory.is_dir():
                continue
            for path in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
                if not path.is_file() or path.name.startswith("."):
                    continue
                if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                try:
                    found.append(self.describe(root, path.name))
                except (SlideNotFound, SlideOpenError) as exc:
                    found.append(
                        {
                            "id": f"{root}/{path.name}",
                            "root": root,
                            "filename": path.name,
                            "name": path.stem,
                            "format": path.suffix.lower().lstrip("."),
                            "error": str(exc),
                        }
                    )
        return found

    def dzi(self, root: str, filename: str) -> str:
        handle = self._open(root, filename)
        return handle.dz.get_dzi("jpeg")

    def tile(self, root: str, filename: str, level: int, col: int, row: int) -> bytes:
        handle = self._open(root, filename)
        with handle.lock:
            try:
                image = handle.dz.get_tile(level, (col, row))
            except (ValueError, openslide.OpenSlideError) as exc:
                raise SlideNotFound("Tile not found") from exc
            return _jpeg_bytes(image)

    def thumbnail(self, root: str, filename: str, size: int = 512) -> bytes:
        path = self.resolve(root, filename)
        cache_key = (str(path), path.stat().st_mtime)
        cached = self._thumbnails.get(cache_key)
        if cached is not None:
            return cached
        handle = self._open(root, filename)
        with handle.lock:
            image = handle.slide.get_thumbnail((size, size))
            data = _jpeg_bytes(image)
        self._thumbnails[cache_key] = data
        return data

    def macro_jpeg(self, root: str, filename: str) -> bytes:
        """Return the macro overview only. Label images are refused."""
        handle = self._open(root, filename)
        with handle.lock:
            images = handle.slide.associated_images
            if "macro" not in images:
                raise SlideNotFound("No macro image")
            # Touch only the macro key. Never index "label".
            return _jpeg_bytes(images["macro"])
