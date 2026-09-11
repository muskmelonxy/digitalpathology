#!/usr/bin/env python3
"""
kfb_extract.py — KFBIO .kfb -> Digital Pathology pyramid tiles
================================================================
Uses vendor libImageOperationLib.so. Writes:
    <tiledir>/<slideId>/<level>/<col>_<row>.jpg   (256x256)

Modes:
  default     full pyramid (coarse → fine)
  --preview   header + associated images + coarsest level only (on-demand tiles later)
  --serve     keep the file open; JSON-line commands on stdin (tile/assoc/quit)

stdout: JSON lines
  {"event":"header", ...}
  {"event":"progress", "pct":N, "msg":"...", "viewable":true?}
  {"width","height","maxLevel","tileSize","nTiles", ...}   # final summary
  {"ok":true,"id":N,...}                                  # --serve replies

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

    assoc_args = [
        ctypes.POINTER(ImageInfoStruct),
        ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
    ]
    for name in ('GetThumnailImageFunc', 'GetPriviewInfoFunc', 'GetLableInfoFunc'):
        fn = getattr(lib, name, None)
        if fn is not None:
            fn.argtypes = assoc_args
            fn.restype = ctypes.c_int

    if hasattr(lib, 'DeleteImageDataFunc'):
        lib.DeleteImageDataFunc.argtypes = [ctypes.c_void_p]
        lib.DeleteImageDataFunc.restype = None
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


def _free_buf(lib, buf):
    if not buf:
        return
    fn = getattr(lib, 'DeleteImageDataFunc', None)
    if fn is None:
        return
    try:
        fn(buf if isinstance(buf, int) else ctypes.cast(buf, ctypes.c_void_p))
    except Exception:
        pass


def fetch_tile(lib, info, fscale, x, y, width=TILE, height=TILE):
    """Decode a ROI. x/y are tile-grid indices at the requested scale.

    IMPORTANT: this vendor library returns broken ROIs for many fscale < 1
    values (whole-slide thumbnail stamped into the corner). Prefer fscale=1.0
    with a larger width/height, then downscale with Pillow when building
    coarse pyramid levels.
    """
    buf = ctypes.c_void_p(); ln = ctypes.c_int()
    r = lib.GetImageDataRoiFunc(ctypes.byref(info), ctypes.c_float(fscale),
                                int(x), int(y), int(width), int(height), ctypes.byref(buf),
                                ctypes.byref(ln), True)
    if r != 1 or ln.value <= 0 or not buf.value:
        return None
    try:
        return ctypes.string_at(buf, ln.value)
    finally:
        _free_buf(lib, buf.value)


def _jpeg_to_tile(jpeg_bytes, blank_jpeg):
    """Resize/pad arbitrary JPEG bytes to TILE x TILE JPEG."""
    if not jpeg_bytes:
        return blank_jpeg
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(jpeg_bytes)).convert('RGB')
        if im.size != (TILE, TILE):
            im = im.resize((TILE, TILE), Image.BILINEAR)
        out = BytesIO()
        im.save(out, format='JPEG', quality=85)
        return out.getvalue()
    except Exception:
        # Pillow optional at runtime; fall back to original bytes
        return jpeg_bytes





def fetch_pyramid_tile(lib, info, level, col, row, cmax, full_w, full_h, blank_jpeg, _cache=None, overview_path=None):
    """Full-res decode at max level; coarser levels crop+resize the overview JPEG.

    Fractional fscale ROIs from this vendor library are unreliable. Building
    coarse levels by mosaicking thousands of native tiles is too slow/heavy.
    Using the associated overview for all non-max levels keeps geometry correct
    (continuous pan/zoom) and reserves GetImageDataRoiFunc(fscale=1) for native
    magnification tiles only.
    """
    if _cache is None:
        _cache = {}
    key = (level, col, row, overview_path or '')
    if key in _cache:
        return _cache[key]

    d = 2 ** (cmax - level)
    level_cols = max(1, math.ceil(full_w / (TILE * d)))
    level_rows = max(1, math.ceil(full_h / (TILE * d)))
    if col < 0 or row < 0 or col >= level_cols or row >= level_rows:
        _cache[key] = blank_jpeg
        return blank_jpeg

    # Native full-resolution tiles
    if d <= 1:
        jpg = fetch_tile(lib, info, 1.0, col, row, TILE, TILE) or blank_jpeg
        _cache[key] = jpg
        return jpg

    # Coarse: crop from overview/macro/thumbnail
    src = overview_path
    if not src or not os.path.exists(src):
        _cache[key] = blank_jpeg
        return blank_jpeg
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(src).convert('RGB')
        ow, oh = im.size
        lw = max(1, math.ceil(full_w / d))
        lh = max(1, math.ceil(full_h / d))
        left = int(col * TILE * ow / lw)
        top = int(row * TILE * oh / lh)
        right = int(min(lw, (col + 1) * TILE) * ow / lw)
        bottom = int(min(lh, (row + 1) * TILE) * oh / lh)
        left = max(0, min(left, ow - 1))
        top = max(0, min(top, oh - 1))
        right = max(left + 1, min(right, ow))
        bottom = max(top + 1, min(bottom, oh))
        tile = im.crop((left, top, right, bottom)).resize((TILE, TILE), Image.BILINEAR)
        buf = BytesIO()
        tile.save(buf, format='JPEG', quality=85)
        out = buf.getvalue()
        _cache[key] = out
        return out
    except Exception as e:
        emit({'event': 'warn', 'msg': f'overview crop L{level} {col},{row}: {e}'})
        _cache[key] = blank_jpeg
        return blank_jpeg



def fetch_assoc(lib, info, kind):
    """kind: thumbnail | preview | label. Returns JPEG/BMP bytes or None."""
    names = {
        'thumbnail': 'GetThumnailImageFunc',
        'preview': 'GetPriviewInfoFunc',
        'label': 'GetLableInfoFunc',
    }
    fn = getattr(lib, names[kind], None)
    if fn is None:
        return None
    data_ptr = ctypes.POINTER(ctypes.c_ubyte)()
    n_bytes = ctypes.c_int()
    w = ctypes.c_int()
    h = ctypes.c_int()
    try:
        ok = fn(ctypes.byref(info), ctypes.byref(data_ptr), ctypes.byref(n_bytes),
                ctypes.byref(w), ctypes.byref(h))
    except Exception as e:
        emit({'event': 'warn', 'msg': f'{kind} assoc call failed: {e}'})
        return None
    if not ok or not data_ptr or n_bytes.value <= 0:
        return None
    try:
        return ctypes.string_at(data_ptr, n_bytes.value)
    finally:
        _free_buf(lib, ctypes.cast(data_ptr, ctypes.c_void_p).value)


def save_assoc_bytes(buf, dest_jpg):
    """Write JPEG as .jpg; BMP as sibling .bmp (Node converts). Returns path written."""
    os.makedirs(os.path.dirname(dest_jpg), exist_ok=True)
    if buf[:2] == b'\xff\xd8':
        with open(dest_jpg, 'wb') as f:
            f.write(buf)
        return dest_jpg
    dest_bmp = dest_jpg[:-4] + '.bmp' if dest_jpg.lower().endswith('.jpg') else dest_jpg + '.bmp'
    with open(dest_bmp, 'wb') as f:
        f.write(buf)
    return dest_bmp


def calc_max_level(width, height, tile=TILE):
    max_level = 0
    w, h = width, height
    while max(w, h) > tile:
        max_level += 1
        w = math.ceil(w / 2)
        h = math.ceil(h / 2)
    return max_level


def write_pyramid_json(base, meta):
    os.makedirs(base, exist_ok=True)
    path = os.path.join(base, 'pyramid.json')
    with open(path, 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    return path


def extract_level(lib, info, base, lv, cmax, cw, ch, blank_jpeg, crop=None, boxC=0, boxR=0):
    d = 2 ** (cmax - lv)
    fs = 1.0 / d
    cn = math.ceil(cw / (TILE * d))
    rn = math.ceil(ch / (TILE * d))
    dd = os.path.join(base, str(lv))
    os.makedirs(dd, exist_ok=True)
    n = 0
    for r in range(rn):
        for c in range(cn):
            if fs >= 0.999 and crop is not None:
                jpg = fetch_pyramid_tile(lib, info, lv, boxC + c, boxR + r, cmax, cw, ch, blank_jpeg)
            else:
                jpg = fetch_pyramid_tile(lib, info, lv, c, r, cmax, cw, ch, blank_jpeg)
            if not jpg:
                jpg = blank_jpeg
            with open(os.path.join(dd, f'{c}_{r}.jpg'), 'wb') as f:
                f.write(jpg)
            n += 1
    return n, cn, rn


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


def dump_assoc(lib, info, uploads, tid):
    found = {}
    if not uploads:
        return found
    mapping = {
        'thumbnail': os.path.join(uploads, 'thumbnails', f'{tid}.jpg'),
        'preview': os.path.join(uploads, 'macros', f'{tid}.jpg'),
        'label': os.path.join(uploads, 'labels', f'{tid}.jpg'),
    }
    for kind, dest in mapping.items():
        try:
            buf = fetch_assoc(lib, info, kind)
        except Exception as e:
            emit({'event': 'warn', 'msg': f'{kind} extract failed: {e}'})
            continue
        if not buf:
            continue
        written = save_assoc_bytes(buf, dest)
        found[kind] = written
        emit({'event': 'progress', 'pct': 12, 'msg': f'Associated {kind} ({len(buf)} bytes)'})
    return found


def run_preview(lib, info, args, W, H, cap_res, blank_jpeg):
    tid = args.tid
    cw, ch = W, H
    cmax = calc_max_level(cw, ch)
    if args.maxlevel is not None:
        cmax = min(cmax, args.maxlevel)

    emit({
        'event': 'header',
        'width': cw, 'height': ch, 'maxLevel': cmax,
        'tileSize': TILE, 'tid': tid,
        'fullWidth': W, 'fullHeight': H, 'capRes': cap_res,
        'tileMode': 'ondemand',
    })

    base = os.path.join(args.tiledir, str(tid))
    if os.path.isdir(base):
        shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    assoc = dump_assoc(lib, info, args.uploads, tid)

    emit({'event': 'progress', 'pct': 20, 'msg': 'Extracting overview tiles…', 'viewable': False})
    # Level 0 from associated overview/thumbnail — avoids OOM and broken fscale<1 ROIs.
    overview_src = None
    for cand in (
        os.path.join(args.uploads, 'overviews', f'{tid}.jpg') if args.uploads else None,
        os.path.join(args.uploads, 'thumbnails', f'{tid}.jpg') if args.uploads else None,
        os.path.join(args.uploads, 'macros', f'{tid}.jpg') if args.uploads else None,
    ):
        if cand and os.path.exists(cand):
            overview_src = cand
            break
    dd = os.path.join(base, '0')
    os.makedirs(dd, exist_ok=True)
    cn = math.ceil(cw / (TILE * (2 ** cmax)))
    rn = math.ceil(ch / (TILE * (2 ** cmax)))
    cn, rn = max(1, cn), max(1, rn)
    n = 0
    if overview_src and cn == 1 and rn == 1:
        try:
            from io import BytesIO
            from PIL import Image
            im = Image.open(overview_src).convert('RGB').resize((TILE, TILE), Image.BILINEAR)
            buf = BytesIO(); im.save(buf, format='JPEG', quality=85)
            open(os.path.join(dd, '0_0.jpg'), 'wb').write(buf.getvalue())
            n = 1
        except Exception as e:
            emit({'event': 'warn', 'msg': f'overview level0 failed: {e}'})
            open(os.path.join(dd, '0_0.jpg'), 'wb').write(blank_jpeg); n = 1
    else:
        # sparse compose via capped pyramid fetch
        cache = {}
        for r in range(rn):
            for c in range(cn):
                jpg = fetch_pyramid_tile(lib, info, 0, c, r, cmax, cw, ch, blank_jpeg, cache)
                open(os.path.join(dd, f'{c}_{r}.jpg'), 'wb').write(jpg or blank_jpeg)
                n += 1
    # ensure overview file exists for navigator
    if args.uploads and overview_src:
        ov = os.path.join(args.uploads, 'overviews', f'{tid}.jpg')
        if overview_src != ov:
            try:
                os.makedirs(os.path.dirname(ov), exist_ok=True)
                if not os.path.exists(ov):
                    shutil.copy2(overview_src, ov)
            except Exception:
                pass


    # Prefer WSI thumbnail as the overview JPEG (navigator), not the cassette photo.
    if args.uploads:
        thumb_src = assoc.get('thumbnail')
        overview_dest = os.path.join(args.uploads, 'overviews', f'{tid}.jpg')
        if thumb_src and thumb_src.lower().endswith('.jpg') and os.path.exists(thumb_src):
            os.makedirs(os.path.dirname(overview_dest), exist_ok=True)
            shutil.copyfile(thumb_src, overview_dest)
            assoc['overview'] = overview_dest

    meta = {
        'width': cw, 'height': ch, 'maxLevel': cmax,
        'tileSize': TILE, 'nTiles': n, 'tid': tid,
        'fullWidth': W, 'fullHeight': H, 'capRes': cap_res,
        'tile_mode': 'ondemand', 'source': 'kfb',
        'offsetX': 0, 'offsetY': 0,
        'assoc': {k: os.path.basename(v) for k, v in assoc.items()},
    }
    write_pyramid_json(base, meta)
    emit({
        'event': 'progress', 'pct': 90,
        'msg': f'Preview ready (level 0 grid={cn}x{rn})',
        'viewable': True, 'level': 0, 'maxLevel': cmax,
    })
    emit(meta)
    return meta


def run_full(lib, info, args, W, H, cap_res, blank_jpeg):
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
    })

    dump_assoc(lib, info, args.uploads, args.tid)

    base = os.path.join(args.tiledir, str(args.tid))
    if os.path.isdir(base):
        shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    total = 0
    for lv in range(cmax + 1):
        n, cn, rn = extract_level(lib, info, base, lv, cmax, cw, ch, blank_jpeg, crop, boxC, boxR)
        total += n
        pct = 10 + int(80 * (lv + 1) / (cmax + 1))
        emit({
            'event': 'progress',
            'pct': pct,
            'msg': f'level {lv}/{cmax} grid={cn}x{rn}',
            'viewable': True,
            'level': lv,
            'maxLevel': cmax,
        })

    meta = {
        'width': cw, 'height': ch, 'maxLevel': cmax,
        'offsetX': boxC * TILE, 'offsetY': boxR * TILE,
        'tileSize': TILE, 'nTiles': total, 'tid': args.tid,
        'fullWidth': W, 'fullHeight': H, 'capRes': cap_res,
        'tile_mode': 'prebuilt', 'source': 'kfb',
    }
    write_pyramid_json(base, meta)
    emit(meta)


def serve_loop(args):
    blank_jpeg = load_blank(args.blank)
    lib = load_lib(args.dll)
    state = {
        'info': None,
        'uploads': getattr(args, 'uploads', None),
        'tid': getattr(args, 'tid', None),
        'path': None,
        'W': 0, 'H': 0, 'cmax': 0, 'cap_res': 0,
    }

    def close_current():
        if state['info'] is not None:
            try:
                lib.UnInitImageFileFunc(ctypes.byref(state['info']))
            except Exception:
                pass
            state['info'] = None
            state['path'] = None

    def open_file(kfb_path):
        close_current()
        info = ImageInfoStruct()
        if lib.InitImageFileFunc(ctypes.byref(info), kfb_path.encode()) != 1:
            raise RuntimeError('InitImageFileFunc failed: ' + kfb_path)
        W, H, _bs, cap_res, _scan = header(lib, info)
        state['info'] = info
        state['path'] = kfb_path
        state['W'] = W
        state['H'] = H
        state['cmax'] = calc_max_level(W, H)
        state['cap_res'] = cap_res
        return W, H, state['cmax'], cap_res

    emit({'event': 'ready', 'mode': 'serve'})
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception as e:
            emit({'ok': False, 'error': f'bad json: {e}'})
            continue
        cmd = msg.get('cmd')
        rid = msg.get('id')
        try:
            if cmd == 'open':
                W, H, cmax, cap_res = open_file(msg['path'])
                emit({'ok': True, 'id': rid, 'width': W, 'height': H,
                      'maxLevel': cmax, 'capRes': cap_res})
            elif cmd == 'tile':
                if state['info'] is None:
                    raise RuntimeError('no file open')
                lv = int(msg['level'])
                col = int(msg['col'])
                row = int(msg['row'])
                out = msg['out']
                cmax = state['cmax']
                overview = None
                uploads = state.get('uploads')
                tid = state.get('tid')
                if uploads and tid is not None:
                    for name in ('overviews', 'thumbnails', 'macros'):
                        cand = os.path.join(uploads, name, f'{tid}.jpg')
                        if os.path.exists(cand):
                            overview = cand
                            break
                jpg = fetch_pyramid_tile(
                    lib, state['info'], lv, col, row, cmax,
                    state['W'], state['H'], blank_jpeg,
                    overview_path=overview,
                ) or blank_jpeg
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, 'wb') as f:
                    f.write(jpg)
                emit({'ok': True, 'id': rid, 'bytes': len(jpg)})
            elif cmd == 'assoc':
                if state['info'] is None:
                    raise RuntimeError('no file open')
                kind = msg.get('kind')
                out = msg['out']
                buf = fetch_assoc(lib, state['info'], kind)
                if not buf:
                    emit({'ok': False, 'id': rid, 'error': f'no {kind} image'})
                    continue
                written = save_assoc_bytes(buf, out)
                emit({'ok': True, 'id': rid, 'path': written, 'bytes': len(buf)})
            elif cmd == 'quit':
                emit({'ok': True, 'id': rid})
                break
            else:
                emit({'ok': False, 'id': rid, 'error': f'unknown cmd {cmd}'})
        except Exception as e:
            emit({'ok': False, 'id': rid, 'error': str(e)})
    close_current()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kfb', default=None)
    ap.add_argument('--tid', default=None)
    ap.add_argument('--tiledir', default=None)
    ap.add_argument('--dll', default=DLL_DEFAULT)
    ap.add_argument('--blank', default=BLANK_DEFAULT)
    ap.add_argument('--maxlevel', type=int, default=None)
    ap.add_argument('--crop-content', action='store_true',
                    help='Scan every full-res block for a content bbox (slow, usually unnecessary)')
    ap.add_argument('--preview', action='store_true',
                    help='Associated images + coarsest level only; tiles generated on demand')
    ap.add_argument('--serve', action='store_true',
                    help='JSON-line worker: keep the KFB open for on-demand tiles')
    ap.add_argument('--uploads', default=None,
                    help='Repo uploads/ dir for thumbnails, labels, macros, overviews')
    args = ap.parse_args()

    if args.serve:
        serve_loop(args)
        return

    if not args.kfb or not args.tid or not args.tiledir:
        ap.error('--kfb, --tid and --tiledir are required unless --serve')

    blank_jpeg = load_blank(args.blank)
    lib = load_lib(args.dll)
    info = ImageInfoStruct()
    if lib.InitImageFileFunc(ctypes.byref(info), args.kfb.encode()) != 1:
        raise RuntimeError('InitImageFileFunc failed: ' + args.kfb)
    try:
        W, H, _bs, cap_res, _scan_scale = header(lib, info)
        emit({'event': 'progress', 'pct': 5, 'msg': f'Opened KFB {W}x{H}'})
        if args.preview:
            run_preview(lib, info, args, W, H, cap_res, blank_jpeg)
        else:
            run_full(lib, info, args, W, H, cap_res, blank_jpeg)
    finally:
        lib.UnInitImageFileFunc(ctypes.byref(info))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        emit({'event': 'error', 'msg': str(e)})
        print(str(e), file=sys.stderr)
        sys.exit(1)
