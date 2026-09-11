#!/usr/bin/env python3
"""
kfb_extract.py — KFBIO .kfb -> Digital Pathology 标准金字塔 转换器
====================================================================
用官方解码库 libImageOperationLib.so (KFB_Convert_TIFF 项目自带) 解码 KFB，
生成与现有 SVS/TIFF 流程一致的金字塔瓦片布局:
    <tiledir>/<slideId>/<level>/<col>_<row>.jpg   (256x256)
    <tiledir>/<slideId>/overview.jpg              (合成全片总览)

用法:
    python3 kfb_extract.py --kfb <file.kfb> --tid <slideId> --tiledir <dir> [--dll <lib>] [--maxlevel N]

stdout 打印一行 JSON: {"width","height","maxLevel","tileSize","nTiles"}
"""
import ctypes, json, os, sys, math, argparse, shutil

DLL_DEFAULT = '/www/digitalpathology/vendor/lib/libImageOperationLib.so'
BLANK_DEFAULT = '/www/digitalpathology/vendor/blank_256.jpg'
TILE = 256

# 256x256 空白(浅灰) JPEG 占位 —— 解码器对"纯玻璃背景"瓦片返回空, 用空白补全网格
# 该文件由 vendor/blank_256.jpg 提供(sharp 生成), 避免在源码内手抄 base64 出错。
BLANK_JPEG = open(os.environ.get('KFB_BLANK', BLANK_DEFAULT), 'rb').read()

class ImageInfoStruct(ctypes.Structure):
    _fields_ = [("DataFilePTR", ctypes.c_int)]


def load_lib(dll):
    if not os.path.exists(dll):
        raise FileNotFoundError(f'KFB 解码库不存在: {dll}')
    lib = ctypes.CDLL(dll)
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
        raise RuntimeError('GetHeaderInfoFunc 失败')
    # 返回 宽, 高, 块尺寸, 微米/像素(CapRes), 物镜倍率(ScanScale)
    return W.value, H.value, bs.value, cr.value, scale.value


def fetch_tile(lib, info, fscale, x, y):
    buf = ctypes.c_void_p(); ln = ctypes.c_int()
    r = lib.GetImageDataRoiFunc(ctypes.byref(info), ctypes.c_float(fscale),
                                int(x), int(y), TILE, TILE, ctypes.byref(buf),
                                ctypes.byref(ln), True)
    if r != 1 or ln.value <= 0:
        return None
    return ctypes.string_at(buf, ln.value)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kfb', required=True)
    ap.add_argument('--tid', required=True)
    ap.add_argument('--tiledir', required=True)
    ap.add_argument('--dll', default=DLL_DEFAULT)
    ap.add_argument('--maxlevel', type=int, default=None)
    args = ap.parse_args()

    lib = load_lib(args.dll)
    info = ImageInfoStruct()
    if lib.InitImageFileFunc(ctypes.byref(info), args.kfb.encode()) != 1:
        raise RuntimeError('InitImageFileFunc 失败: ' + args.kfb)
    try:
        W, H, _bs, cap_res, scan_scale = header(lib, info)

        # 层级数: 逐级减半直到 1x1 瓦片
        maxLevel = 0
        w, h = W, H
        while max(w, h) > TILE:
            maxLevel += 1
            w = math.ceil(w / 2); h = math.ceil(h / 2)
        if args.maxlevel is not None:
            maxLevel = min(maxLevel, args.maxlevel)

        base = os.path.join(args.tiledir, str(args.tid))
        # 清空该切片旧瓦片目录, 避免与上一轮生成混存(层级顺序可能已变化)
        if os.path.isdir(base):
            shutil.rmtree(base, ignore_errors=True)
        os.makedirs(base, exist_ok=True)

        # ---- 解析全部层级 ----
        # 关键: GetImageDataRoiFunc 的 posX/posY 是【块索引】(col,row), 不是像素!
        #       全分辨率: fScale=1.0, 块(c,r) = 256x256 源像素
        #       粗层:     fScale=1/2^lv (解码器原生下采样), 块(c,r)=该层网格索引
        # server 约定: level 0 = 最低分辨率, maxLevel = 全分辨率。
        maxLevel = 0
        w, h = W, H
        while max(w, h) > TILE:
            maxLevel += 1
            w = math.ceil(w / 2); h = math.ceil(h / 2)
        if args.maxlevel is not None:
            maxLevel = min(maxLevel, args.maxlevel)

        # 可选: 内容包围盒(块索引)。满幅切片内容遍及全图 => 不裁剪。
        # (旧实现因错误用"像素坐标"导致只见单块, 才需要裁剪; 现在真实切片内容遍布全图)
        ncols0 = math.ceil(W / TILE)
        nrows0 = math.ceil(H / TILE)
        minC, maxC, minR, maxR = ncols0, -1, nrows0, -1
        for r in range(nrows0):
            for c in range(ncols0):
                if fetch_tile(lib, info, 1.0, c, r):
                    if c < minC: minC = c
                    if c > maxC: maxC = c
                    if r < minR: minR = r
                    if r > maxR: maxR = r
            if r % 32 == 0:
                print(f'  扫描 行 {r + 1}/{nrows0}', flush=True)
        # 内容覆盖比例: 高 => 整片即内容, 不裁剪
        covered = 0 if maxC < 0 else (maxC-minC+1)*(maxR-minR+1)
        total_blocks = ncols0*nrows0
        print(f'  内容包围盒(块): col[{minC}..{maxC}] row[{minR}..{maxR}] 覆盖~{covered}/{total_blocks}', flush=True)
        if maxC < 0 or covered >= 0.6*total_blocks:
            crop = None; cw, ch, boxC, boxR = W, H, 0, 0
        else:
            crop = (minC, minR, maxC, maxR)
            cw = min((maxC-minC+1)*TILE, W - minC*TILE)
            ch = min((maxR-minR+1)*TILE, H - minR*TILE)
            boxC, boxR = minC, minR

        # 内容尺寸层级
        cmax = 0; w, h = cw, ch
        while max(w, h) > TILE:
            cmax += 1; w = math.ceil(w/2); h = math.ceil(h/2)
        if args.maxlevel is not None:
            cmax = min(cmax, args.maxlevel)

        total = 0
        for lv in range(cmax + 1):
            d = 2 ** (cmax - lv)          # server level lv 下采样倍数
            fs = 1.0 / d                   # 解码器 fScale (1/d)
            cn = math.ceil(cw / (TILE * d))
            rn = math.ceil(ch / (TILE * d))
            dd = os.path.join(base, str(lv)); os.makedirs(dd, exist_ok=True)
            for r in range(rn):
                for c in range(cn):
                    # 全分辨率层用内容块(若裁剪则偏移块索引), 粗层用解码器下采样
                    if fs >= 0.999 and crop is None:
                        jpg = fetch_tile(lib, info, 1.0, c, r)
                    elif fs >= 0.999 and crop is not None:
                        jpg = fetch_tile(lib, info, 1.0, boxC + c, boxR + r)
                    else:
                        jpg = fetch_tile(lib, info, fs, c, r)
                    if not jpg:
                        jpg = BLANK_JPEG
                    with open(os.path.join(dd, f'{c}_{r}.jpg'), 'wb') as f:
                        f.write(jpg)
                    total += 1
            print(f'  [level {lv}] d={int(d)} fs={fs} grid={cn}x{rn}', flush=True)

        print(json.dumps({'width': cw, 'height': ch, 'maxLevel': cmax,
                          'offsetX': boxC * TILE, 'offsetY': boxR * TILE,
                          'tileSize': TILE, 'nTiles': total, 'tid': args.tid,
                          'fullWidth': W, 'fullHeight': H, 'capRes': cap_res}))
    finally:
        lib.UnInitImageFileFunc(ctypes.byref(info))


if __name__ == '__main__':
    main()