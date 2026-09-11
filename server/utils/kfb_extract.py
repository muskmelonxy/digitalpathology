#!/usr/bin/env python3
"""
kfb_extract.py — KFBIO .kfb -> Digital Pathology pyramid tiles
================================================================
Uses vendor libImageOperationLib.so. Writes:
    <tiledir>/<slideId>/<level>/<col>_<row>.jpg   (256x256)

stdout: JSON lines
  {"event":"header", ...}
  {"event":"progress", "pct":N, "msg":"...", "viewable":true?}
  {"width","height","maxLevel","tileSize","nTiles", ...}   # final summary

Vendor paths default to <repo>/vendor/... (override with --dll / KFB_BLANK /
KFB_DLL). The old hardcoded /www/digitalpathology/... path is a fallback.
"""
import ctypes
import json
import os
import sys
import math
import argparse
import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
VENDOR_LIB = os.path.join(REPO_ROOT, 'vendor', 'lib')
DLL_DEFAULT = os.environ.get(
    'KFB_DLL',
    os.path.join(VENDOR_LIB, 'libImageOperationLib.so'),
)
BLANK_DEFAULT = os.environ.get(
    'KFB_BLANK',
    os.path.join(REPO_ROOT, 'vendor', 'blank_256.jpg'),
)
PROD_DLL = '/www/digitalpathology/vendor/lib/libImageOperationLib.so'
PROD_BLANK = '/www/digitalpathology/vendor/blank_256.jpg'
TILE = 256


def emit(obj):
    print(json.dumps(obj), flush=True)


def resolve_path(preferred, fallback):
    if preferred and os.path.exists(preferred):
        return preferred
    if fallback and os.path.exists(fallback):
        return fallback
    return preferred or fallback


def load_blank(path):
    blank_path = resolve_path(path, PROD_BLANK)
    if not blank_path or not os.path.exists(blank_path):
        raise FileNotFoundError(
            f'KFB blank tile JPEG not found (tried {path!r}). '
            'Set KFB_BLANK or place vendor/blank_256.jpg next to the repo.'
        )
    with open(blank_path, 'rb') as f:
        return f.read()


def preload_libjpeg():
    """Make libjpeg.so.9 visible before loading the vendor decoder."""
    candidates = [
        os.environ.get('KFB_LIBJPEG'),
        os.path.join(VENDOR_LIB, 'libjpeg.so.9'),
        '/usr/lib/x86_64-linux-gnu/libjpeg.so.9',
        '/usr/lib/libjpeg.so.9',
    ]
    for cand in candidates:
        if cand and os.path.exists(cand):
            try:
                ctypes.CDLL(cand, mode=ctypes.RTLD_GLOBAL)
                return cand
            except OSError as e:
                emit({'event': 'warn', 'msg': f'libjpeg preload failed {cand}: {e}'})
    return None


class ImageInfoStruct(ctypes.Structure):
    _fields_ = [("DataFilePTR", ctypes.c_int)]


def load_lib(dll):
    dll = resolve_path(dll, PROD_DLL)
    if not dll or not os.path.exists(dll):
        raise FileNotFoundError(f'KFB decoder library not found: {dll}')
    preload_libjpeg()
    try:
        lib = ctypes.CDLL(dll)
    except OSError as e:
        raise OSError(
            f'Failed to load {dll}: {e}. '
            'The decoder needs libjpeg.so.9 — run scripts/install-kfb-deps.sh '
            'or copy libjpeg.so.9 into vendor/lib/ and set LD_LIBRARY_PATH.'
        ) from e
    lib.InitImageFileFunc.argtypes = [ctypes.POINTER(ImageInfoStruct), ctypes.c_char_p]
    lib.InitImageFileFunc.restype = ctypes.c_int
    lib.GetHeaderInfoFunc.argtypes = [
        ctypes.POINTER(ImageInfoStruct),
        ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_float), ctypes.POINTER(ctypes.c_double),
        ctypes.POINTER(ctypes.c_float), ctypes.POINTER(ctypes.c_int),
    ]
    lib.GetImageDataRoiFunc.argtypes = [
        ctypes.POINTER(ImageInfoStruct), ctypes.c_float, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_int), ctypes.c_bool,
    ]
    lib.GetImageDataRoiFunc.restype = ctypes.c_int
    lib.UnInitImageFileFunc.argtypes = [ctypes.POINTER(ImageInfoStruct)]
    return lib


def header(lib, info):
    H, W, scale = ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    sp = ctypes.c_float(); sd = ctypes.c_double(); cr = ctypes.c_float(); bs = ctypes.c_int()
    r = lib.GetHeaderInfoFunc(ctypes.byref(info), ctypes.byref(H), ctypes.byref(W),
                              ctypes.byref(scale), ctypes.byref(sp), ctypes.byref(sd),
                              ctypes.byref(cr), ctypes.byref(bs))
    if r != 1:
        raise RuntimeError('GetHeaderInfoFunc failed')
    return W.value, H.value, bs.value, cr.value, scale.value


def fetch_tile(lib, info, fscale, x, y):
    buf = ctypes.c_void_p(); ln = ctypes.c_int()
    r = lib.GetImageDataRoiFunc(ctypes.byref(info), ctypes.c_float(fscale),
                                int(x), int(y), TILE, TILE, ctypes.byref(buf),
                                ctypes.byref(ln), True)
    if r != 1 or ln.value <= 0:
        return None
    return ctypes.string_at(buf, ln.value)


def calc_max_level(width, height, tile=TILE):
    max_level = 0
    w, h = width, height
    while max(w, h) > tile:
        max_level += 1
        w = math.ceil(w / 2)
        h = math.ceil(h / 2)
    return max_level


def scan_content_bbox(lib, info, W, H):
    """Optional full-res occupancy scan. Expensive — doubles decode work."""
    ncols0 = math.ceil(W / TILE)
    nrows0 = math.ceil(H / TILE)
    minC, maxC, minR, maxR = ncols0, -1, nrows0, -1
    for r in range(nrows0):
        for c in range(ncols0):
            if fetch_tile(lib, info, 1.0, c, r):
                if c < minC:
                    minC = c
                if c > maxC:
                    maxC = c
                if r < minR:
                    minR = r
                if r > maxR:
                    maxR = r
        if r % 32 == 0:
            emit({'event': 'progress', 'pct': int(5 * (r + 1) / max(1, nrows0)),
                  'msg': f'Content scan row {r + 1}/{nrows0}'})
    covered = 0 if maxC < 0 else (maxC - minC + 1) * (maxR - minR + 1)
    total_blocks = ncols0 * nrows0
    emit({'event': 'progress', 'pct': 8,
          'msg': f'bbox col[{minC}..{maxC}] row[{minR}..{maxR}] ~{covered}/{total_blocks}'})
    if maxC < 0 or covered >= 0.6 * total_blocks:
        return W, H, 0, 0, None
    cw = min((maxC - minC + 1) * TILE, W - minC * TILE)
    ch = min((maxR - minR + 1) * TILE, H - minR * TILE)
    return cw, ch, minC, minR, (minC, minR, maxC, maxR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kfb', required=True)
    ap.add_argument('--tid', required=True)
    ap.add_argument('--tiledir', required=True)
    ap.add_argument('--dll', default=DLL_DEFAULT)
    ap.add_argument('--blank', default=BLANK_DEFAULT)
    ap.add_argument('--maxlevel', type=int, default=None)
    ap.add_argument('--crop-content', action='store_true',
                    help='Scan every full-res block for a content bbox (slow, usually unnecessary)')
    args = ap.parse_args()

    blank_jpeg = load_blank(args.blank)
    lib = load_lib(args.dll)
    info = ImageInfoStruct()
    if lib.InitImageFileFunc(ctypes.byref(info), args.kfb.encode()) != 1:
        raise RuntimeError('InitImageFileFunc failed: ' + args.kfb)
    try:
        W, H, _bs, cap_res, scan_scale = header(lib, info)
        emit({'event': 'progress', 'pct': 5, 'msg': f'Opened KFB {W}x{H}'})

        if args.crop_content:
            cw, ch, boxC, boxR, crop = scan_content_bbox(lib, info, W, H)
        else:
            cw, ch, boxC, boxR, crop = W, H, 0, 0, None

        cmax = calc_max_level(cw, ch)
        if args.maxlevel is not None:
            cmax = min(cmax, args.maxlevel)

        emit({
            'event': 'header',
            'width': cw, 'height': ch, 'maxLevel': cmax,
            'tileSize': TILE, 'tid': args.tid,
            'fullWidth': W, 'fullHeight': H, 'capRes': cap_res,
            'scanScale': scan_scale,
        })

        base = os.path.join(args.tiledir, str(args.tid))
        if os.path.isdir(base):
            shutil.rmtree(base, ignore_errors=True)
        os.makedirs(base, exist_ok=True)

        # Server convention: level 0 = lowest resolution, cmax = full resolution.
        # Generate coarse → fine so the viewer can open as soon as level 0 exists.
        total = 0
        for lv in range(cmax + 1):
            d = 2 ** (cmax - lv)
            fs = 1.0 / d
            cn = math.ceil(cw / (TILE * d))
            rn = math.ceil(ch / (TILE * d))
            dd = os.path.join(base, str(lv))
            os.makedirs(dd, exist_ok=True)
            for r in range(rn):
                for c in range(cn):
                    if fs >= 0.999 and crop is not None:
                        jpg = fetch_tile(lib, info, 1.0, boxC + c, boxR + r)
                    else:
                        jpg = fetch_tile(lib, info, fs, c, r)
                    if not jpg:
                        jpg = blank_jpeg
                    with open(os.path.join(dd, f'{c}_{r}.jpg'), 'wb') as f:
                        f.write(jpg)
                    total += 1
            pct = 10 + int(80 * (lv + 1) / (cmax + 1))
            viewable = lv >= 0
            emit({
                'event': 'progress',
                'pct': pct,
                'msg': f'level {lv}/{cmax} grid={cn}x{rn}',
                'viewable': viewable,
                'level': lv,
                'maxLevel': cmax,
            })

        emit({
            'width': cw, 'height': ch, 'maxLevel': cmax,
            'offsetX': boxC * TILE, 'offsetY': boxR * TILE,
            'tileSize': TILE, 'nTiles': total, 'tid': args.tid,
            'fullWidth': W, 'fullHeight': H, 'capRes': cap_res,
        })
    finally:
        lib.UnInitImageFileFunc(ctypes.byref(info))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        emit({'event': 'error', 'msg': str(e)})
        print(str(e), file=sys.stderr)
        sys.exit(1)
