/**
 * kfbProcessor.js — 用官方 KFBIO 解码库把 .kfb 转成标准金字塔
 * 取代旧 kfbioParser(只抽低清预览)。依赖:
 *   - server/utils/kfb_extract.py      (ctypes 调用解码器)
 *   - vendor/lib/libImageOperationLib.so (KFB_Convert_TIFF 项目自带厂商库)
 *   - vendor/blank_256.jpg             (背景瓦片占位)
 */
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');

// 用系统 python(无 miniforge conda 插件日志噪音)。kfb_extract 只用 ctypes+stdlib。
const PYTHON = process.env.PFB_PYTHON || '/usr/bin/python3';
const SCRIPT = path.join(__dirname, 'kfb_extract.py');

/** 运行转换器, 返回捕获的 JSON(丢弃 conda 插件噪音) */
function runConverter(args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CONDA_NO_PLUGINS: 'true' };
    execFile(PYTHON, args, { env, maxBuffer: 32 * 1024 * 1024, timeout: 900000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[kfb] converter 退出错误:', String(stderr || err.message || '').slice(-1500));
        return reject(new Error('kfb 转换失败'));
      }
      const lines = String(stdout).trim().split('\n');
      const jsonLine = lines.filter(l => l.trim().startsWith('{')).pop();
      if (!jsonLine) {
        console.error('[kfb] 无结构化输出:', String(stdout).slice(-500));
        return reject(new Error('kfb 转换器未返回元数据'));
      }
      try {
        resolve(JSON.parse(jsonLine));
      } catch (e) {
        return reject(new Error('kfb 输出 JSON 解析失败'));
      }
    });
  });
}

/**
 * 把某个 level 的瓦片合成一张缩略图(jpeg, 最长边 ≤400)。
 * tilesDir      = <uploads>/tiles/<slideId>
 * thumbDir      = <uploads>/thumbnails
 */
async function makeThumbnail(meta, slideId, tilesDir, thumbDir) {
  try {
    // 选宽度最接近 400px 的存储层。存储层 l 的 scale=2^(maxLevel-l), 层宽=width/scale。
    // 故 l ≈ maxLevel - log2(width/400)。
    const lv = Math.max(0, Math.min(meta.maxLevel,
      Math.round(meta.maxLevel - Math.log2(meta.width / 400))));
    const dir = path.join(tilesDir, String(lv));
    if (!fs.existsSync(dir)) return;
    const files = (await fs.readdir(dir)).filter(f => /^\d+_\d+\.jpg$/.test(f));
    const coords = files.map(f => {
      const m = f.match(/^(\d+)_(\d+)\.jpg$/);
      return { c: +m[1], r: +m[2], file: path.join(dir, f) };
    });
    if (!coords.length) return;
    const ncols = Math.max(...coords.map(x => x.c)) + 1;
    const nrows = Math.max(...coords.map(x => x.r)) + 1;
    const W = 256 * ncols, H = 256 * nrows;
    const layers = [];
    for (const x of coords) {
      layers.push({ input: await sharp(x.file).png().toBuffer(), left: x.c * 256, top: x.r * 256 });
    }
    const canvas = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 245, g: 245, b: 245 } }
    }).composite(layers).jpeg({ quality: 80 }).toBuffer();
    await fs.ensureDir(thumbDir);
    await sharp(canvas).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 80 })
      .toFile(path.join(thumbDir, `${slideId}.jpg`));
  } catch (e) {
    console.error(`[kfb] 缩略图生成失败 slide ${slideId}:`, e.message);
  }
}

/**
 * 自底向上合成粗层级(level maxLevel-1 .. 0)。
 * 全分辨率瓦片已由 kfb_extract 解码到 level maxLevel。每个粗层瓦片 = 取其父层
 * 2x2 相邻瓦片拼成 512x512 后缩到 256(area 平均 = 正确金字塔下采样), 保证各层对齐。
 * @param tilesDir  <uploads>/tiles/<slideId>
 * @param meta      {width,height,maxLevel}
 */
async function buildCoarsePyramid(tilesDir, meta) {
  const { width, height, maxLevel } = meta;
  const blank = await fs.readFile('/www/digitalpathology/vendor/blank_256.jpg'); // JPEG 直接给 sharp 解码
  let cols = Math.ceil(width / 256);
  let rows = Math.ceil(height / 256);
  let parentDir = path.join(tilesDir, String(maxLevel));

  for (let lv = maxLevel - 1; lv >= 0; lv--) {
    const newCols = Math.ceil(cols / 2);
    const newRows = Math.ceil(rows / 2);
    const dir = path.join(tilesDir, String(lv));
    await fs.ensureDir(dir);

    for (let r = 0; r < newRows; r++) {
      for (let c = 0; c < newCols; c++) {
        const layers = [];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const pc = c * 2 + dx, pr = r * 2 + dy;
            if (pc >= cols || pr >= rows) continue;
            const p = path.join(parentDir, `${pc}_${pr}.jpg`);
            let buf = null;
            try { buf = await fs.readFile(p); } catch (e) { buf = null; }
            if (!buf || buf.length === 0) buf = blank;
            layers.push({ input: buf, left: dx * 256, top: dy * 256 });
          }
        }
        const tile = await sharp({
          create: { width: 512, height: 512, channels: 3, background: { r: 245, g: 245, b: 245 } }
        }).composite(layers).resize(256, 256).jpeg({ quality: 80 }).toBuffer();
        await fs.writeFile(path.join(dir, `${c}_${r}.jpg`), tile);
      }
      if (r % 8 === 0) console.log(`  [coarse] level ${lv} 行 ${r + 1}/${newRows}`);
    }
    cols = newCols; rows = newRows; parentDir = dir;
  }
}

/**
 * 主入口: 解码全分辨率瓦片 + 自底向上合成粗层 + 生成缩略图。
 * @returns {{width,height,maxLevel,tileSize,slidesDir}}  slidesDir=<uploads>/tiles
 */
async function processKFB(slideId, filePath, uploadsDir) {
  const tilesRoot = path.join(uploadsDir, 'tiles');
  const meta = await runConverter([
    SCRIPT, '--kfb', filePath, '--tid', slideId, '--tiledir', tilesRoot
  ]);
  const slideTilesDir = path.join(tilesRoot, String(slideId));
  // 注意: kfb_extract 现已直接生成全部层级(块索引坐标 + fScale=1/2^lv 原生下采样),
  // 不再需要自底向上合成 buildCoarsePyramid(旧逻辑基于错误的像素坐标只够单块)。
  await makeThumbnail(meta, slideId, slideTilesDir, path.join(uploadsDir, 'thumbnails'));
  return meta;
}

module.exports = { processKFB, runConverter };