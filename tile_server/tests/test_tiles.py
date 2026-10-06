"""Tile-server tests.

The OpenSlide case downloads the public Aperio sample
``CMU-1-Small-Region.svs`` (no public .kfb sample exists). KFB routing is
covered with a fake kfbslide handle so the suite still runs without a slide.
"""

from __future__ import annotations

import io
import urllib.request
from pathlib import Path

import pytest
from PIL import Image

from tile_server.app import create_app
from tile_server.slides import (
    KfbAdapter,
    SlideNotFound,
    SlideStore,
    detect_format,
    open_any,
)

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
SVS_NAME = "CMU-1-Small-Region.svs"
SVS_URLS = (
    "https://openslide.cs.cmu.edu/download/openslide-testdata/Aperio/CMU-1-Small-Region.svs",
    "http://openslide.cs.cmu.edu/download/openslide-testdata/Aperio/CMU-1-Small-Region.svs",
)


def _download_svs() -> Path:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    destination = FIXTURE_DIR / SVS_NAME
    if destination.is_file() and destination.stat().st_size > 100_000:
        return destination
    last_error = None
    for url in SVS_URLS:
        try:
            urllib.request.urlretrieve(url, destination)
            if destination.stat().st_size > 100_000:
                return destination
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(f"Could not download {SVS_NAME}: {last_error}")


class _Assoc:
    """Associated-image map that records which keys are actually decoded."""

    def __init__(self):
        self.reads = []

    def keys(self):
        return ["label", "macro"]

    def __contains__(self, key):
        return key in ("label", "macro")

    def __getitem__(self, key):
        self.reads.append(key)
        if key == "label":
            return Image.new("RGB", (16, 8), (1, 2, 3))
        if key == "macro":
            return Image.new("RGB", (24, 12), (4, 80, 90))
        raise KeyError(key)


class _FakeKfb:
    def __init__(self, path):
        self.path = path
        self.dimensions = (1024, 768)
        self.level_count = 1
        self.level_dimensions = ((1024, 768),)
        self.level_downsamples = (1.0,)
        self.properties = {
            "openslide.mpp-x": "0.25",
            "openslide.mpp-y": "0.25",
            "openslide.objective-power": "40",
            "openslide.vendor": "kfbio",
        }
        self.associated_images = _Assoc()

    def get_thumbnail(self, size):
        return Image.new("RGB", (64, 48), (120, 80, 90))

    def read_region(self, location, level, size):
        return Image.new("RGBA", size, (180, 100, 120, 255))

    def get_best_level_for_downsample(self, _downsample):
        return 0


@pytest.fixture()
def kfb_dir(tmp_path, monkeypatch):
    import tile_server.slides as slides

    monkeypatch.setattr(slides, "kfbslide", type("K", (), {"OpenSlide": _FakeKfb}))
    slide = tmp_path / "study.kfb"
    slide.write_bytes(b"not-a-real-kfb")
    return tmp_path


@pytest.fixture()
def svs_dir(tmp_path):
    source = _download_svs()
    target = tmp_path / SVS_NAME
    target.write_bytes(source.read_bytes())
    return tmp_path


def _client(directory):
    app = create_app({"library": directory, "uploads": directory / "empty-uploads"})
    app.config["TESTING"] = True
    return app.test_client()


def test_kfb_adapter_translates_open_errors(monkeypatch):
    import tile_server.slides as slides

    class Boom:
        def __init__(self, path):
            raise RuntimeError("unsupported KFB version")

    monkeypatch.setattr(slides, "kfbslide", type("K", (), {"OpenSlide": Boom}))
    with pytest.raises(slides.openslide.OpenSlideError, match="kfbslide cannot open"):
        open_any("slide.kfb")


def test_kfb_without_package_is_a_clear_error(monkeypatch):
    import tile_server.slides as slides

    monkeypatch.setattr(slides, "kfbslide", None)
    with pytest.raises(slides.openslide.OpenSlideError, match="not installed"):
        KfbAdapter("slide.kfb")
    assert detect_format("slide.kfb") is None


def test_kfb_metadata_hides_label_and_serves_tiles(kfb_dir):
    store = SlideStore({"library": kfb_dir})
    meta = store.describe("library", "study.kfb")
    assert meta["format"] == "kfbio"
    assert meta["width"] == 1024
    assert meta["objective_power"] == 40
    assert meta["mpp_x"] == 0.25
    assert meta["has_macro"] is True
    assert "label" not in meta
    dumped = str(meta).lower()
    assert "label" not in dumped

    client = _client(kfb_dir)
    dzi = client.get("/r/library/study.kfb.dzi")
    assert dzi.status_code == 200
    assert "xml" in dzi.content_type
    assert b"<Image" in dzi.data
    assert b'Width="1024"' in dzi.data

    tile = client.get("/r/library/study.kfb_files/0/0_0.jpeg")
    assert tile.status_code == 200
    assert tile.content_type == "image/jpeg"
    assert tile.data[:2] == b"\xff\xd8"

    past_edge = client.get("/r/library/study.kfb_files/0/50_50.jpeg")
    assert past_edge.status_code == 404
    assert past_edge.get_json()["error"] == "Tile not found"
    missing_slide = client.get("/r/library/missing.kfb.dzi")
    assert missing_slide.status_code == 404
    assert missing_slide.get_json()["error"] == "Slide not found"

    thumb = client.get("/r/library/study.kfb/thumbnail.jpg")
    assert thumb.status_code == 200
    assert thumb.data[:2] == b"\xff\xd8"

    hidden = client.get("/r/library/study.kfb/macro.jpg")
    assert hidden.status_code == 403
    shown = client.get("/r/library/study.kfb/macro.jpg?explicit=1")
    assert shown.status_code == 200
    assert shown.data[:2] == b"\xff\xd8"
    handle = client.application.config["SLIDE_STORE"]._open("library", "study.kfb")
    assert handle.slide.associated_images.reads == ["macro"]

    for path in (
        "/r/library/study.kfb/label.jpg",
        "/r/library/study.kfb/label.jpg?explicit=1",
        "/r/library/study.kfb/associated/label",
    ):
        assert client.get(path).status_code == 404


def test_kfb_thumbnail_shrinks_when_reader_ignores_size(monkeypatch, tmp_path):
    import tile_server.slides as slides

    class Oversized:
        """Stand-in for kfbslide 0.3.4, which returns the smallest pyramid level."""

        def __init__(self, path):
            self.path = path

        def get_thumbnail(self, size):
            return Image.new("RGB", (1014, 770), (180, 100, 120))

    monkeypatch.setattr(slides, "kfbslide", type("K", (), {"OpenSlide": Oversized}))
    image = KfbAdapter(tmp_path / "level.kfb").get_thumbnail((512, 512))
    assert image.width <= 512
    assert image.height <= 512
    assert image.width == 512
    assert image.height < 512

    class AlreadySmall(Oversized):
        def get_thumbnail(self, size):
            return Image.new("RGB", (64, 48), (10, 20, 30))

    monkeypatch.setattr(slides, "kfbslide", type("K", (), {"OpenSlide": AlreadySmall}))
    small = KfbAdapter(tmp_path / "small.kfb").get_thumbnail((512, 512))
    assert small.size == (64, 48)


def test_adapter_read_region_wraps_errors(monkeypatch):
    import tile_server.slides as slides

    class Flaky:
        def __init__(self, path):
            pass

        def read_region(self, location, level, size):
            raise RuntimeError("decode failed")

    monkeypatch.setattr(slides, "kfbslide", type("K", (), {"OpenSlide": Flaky}))
    adapter = KfbAdapter("x.kfb")
    with pytest.raises(slides.openslide.OpenSlideError, match="decode failed"):
        adapter.read_region((0, 0), 0, (16, 16))
    assert adapter.color_profile is None
    adapter.set_cache(object())


def test_resolve_rejects_traversal(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    secret = outside / "secret.svs"
    secret.write_bytes(b"nope")
    library = tmp_path / "library"
    library.mkdir()
    store = SlideStore({"library": library})
    with pytest.raises(SlideNotFound):
        store.resolve("library", "../outside/secret.svs")
    with pytest.raises(SlideNotFound):
        store.resolve("library", "..\\outside\\secret.svs")
    with pytest.raises(SlideNotFound):
        store.resolve("nope", "secret.svs")
    with pytest.raises(SlideNotFound):
        store.resolve("library", ".hidden.svs")


def test_public_svs_dzi_and_tiles(svs_dir):
    client = _client(svs_dir)
    listing = client.get("/slides")
    assert listing.status_code == 200
    slides = listing.get_json()
    assert len(slides) == 1
    meta = slides[0]
    assert meta["filename"] == SVS_NAME
    assert meta["format"] == "aperio"
    assert meta["width"] > 0 and meta["height"] > 0
    assert meta["mpp_x"] and meta["mpp_x"] > 0
    assert meta["level_count"] >= 1
    assert "label" not in meta

    dzi = client.get(f"/r/library/{SVS_NAME}.dzi")
    assert dzi.status_code == 200
    assert "xml" in dzi.content_type
    assert b"<Image" in dzi.data
    assert b'Format="jpeg"' in dzi.data

    # DeepZoom level 0 is the overview; the highest level is full resolution.
    low = client.get(f"/r/library/{SVS_NAME}_files/0/0_0.jpeg")
    assert low.status_code == 200
    assert low.content_type == "image/jpeg"
    assert low.data[:2] == b"\xff\xd8"
    assert len(low.data) > 200
    Image.open(io.BytesIO(low.data)).verify()

    top = meta["dzi_levels"] - 1
    high = client.get(f"/r/library/{SVS_NAME}_files/{top}/0_0.jpeg")
    assert high.status_code == 200
    assert high.content_type == "image/jpeg"
    assert high.data[:2] == b"\xff\xd8"
    Image.open(io.BytesIO(high.data)).verify()

    if top >= 2:
        mid = client.get(f"/r/library/{SVS_NAME}_files/{top // 2}/0_0.jpeg")
        assert mid.status_code == 200
        assert mid.data[:2] == b"\xff\xd8"

    missing = client.get(f"/r/library/{SVS_NAME}_files/{top}/999_999.jpeg")
    assert missing.status_code == 404
    assert missing.get_json()["error"] == "Tile not found"

    thumb = client.get(f"/r/library/{SVS_NAME}/thumbnail.jpg")
    assert thumb.status_code == 200
    assert thumb.content_type == "image/jpeg"
    assert thumb.data[:2] == b"\xff\xd8"

    escaped = client.get("/r/library/..%2F..%2Fetc%2Fpasswd.dzi")
    assert escaped.status_code == 404
    assert client.get("/health").status_code == 200
