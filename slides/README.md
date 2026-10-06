# Slide folder

Put whole-slide images in this directory to view them directly (no conversion step).

Supported for direct viewing:

- `.kfb`, `.kfbio` — KFBIO / 江丰, read by the `kfbslide` package
- `.svs`, `.tif`, `.tiff`, `.ndpi`, `.scn`, `.vms`, `.bif` — read by OpenSlide

Restart is not required. The library page picks up new files on refresh.

Label images embedded in a slide are never served. Do not rename or extract them by hand into this folder if they contain patient information.
