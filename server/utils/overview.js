// overview.js — 为切片生成一张清晰的"全片总览图" (从现有金字塔瓦片合成, 不重新解码原片)
// 输出: uploads/overviews/<slideId>.jpg (~1600px 宽, 质量85)
// 做法: 选一个宽度最接近 TARGET_W 的现有层级, 把该层所有瓦片拼成整图后缩放到 TARGET_W。
// 纯新增文件, 不触碰任何已有数据。
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');

const OVERVIEW_DIR = path.join(__dirname, '../../uploads/overviews');
const TARGET_W = 1600;
const JPEG_QUALITY = 85;

async function ensureOverview(slide, { force = false } = {}) {
  if (!slide || slide.status !== 'ready') return null;
  const outPath = path.join(OVERVIEW_DIR, `${slide.id}.jpg`);
  if (!force && fs.existsSync(outPath)) return `/uploads/overviews/${slide.id}.jpg`;

  const tilesBase = path.join(__dirname, '../../uploads/tiles', String(slide.id));
  const { width, height, max_level: maxLevel, tile_size: tileSize, filename, original_format } = slide;
  if (!width || !height || maxLevel == null) return null;

  let bestL = null, bestDiff = Infinity;
  for (let l = 0; l <= maxLevel; l++) {
    const levelDir = path.join(tilesBase, String(l));
    if (!fs.existsSync(levelDir)) continue;
    const levelW = Math.ceil(width / Math.pow(2, maxLevel - l));
    const diff = Math.abs(levelW - TARGET_W);
    if (diff < bestDiff) { bestDiff = diff; bestL = l; }
  }

  if (bestL == null) {
    const src = filename ? path.join(__dirname, '../../uploads/slides', filename) : null;
    const fmt = String(original_format || '').toLowerCase();
    if (src && fs.existsSync(src) && fmt !== 'kfb' && fmt !== 'kfbio') {
      try {
        const { generateOverviewFromSource, readPyramidMeta } = require('./pyramid');
        const meta = await readPyramidMeta(tilesBase);
        await generateOverviewFromSource(src, outPath, {
          maxEdge: TARGET_W,
          sourcePage: meta && meta.source_page,
          pages: meta && meta.pages
        });
        return `/uploads/overviews/${slide.id}.jpg`;
      } catch (e) {
        console.error(`Overview from source failed slide ${slide.id}:`, e.message);
        return null;
      }
    }
    return null;
  }

  const scale = Math.pow(2, maxLevel - bestL);
  const levelW = Math.ceil(width / scale);
  const levelH = Math.ceil(height / scale);
  const cols = Math.ceil(levelW / tileSize);
  const rows = Math.ceil(levelH / tileSize);

  // 收集该层所有瓦片
  const composite = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tilePath = path.join(tilesBase, String(bestL), `${c}_${r}.jpg`);
      if (fs.existsSync(tilePath)) {
        composite.push({ input: tilePath, left: c * tileSize, top: r * tileSize });
      }
    }
  }
  if (composite.length === 0) return null;

  await fs.ensureDir(OVERVIEW_DIR);

  // 拼出该层整图 (含边缘白色填充), 再缩放到 TARGET_W
  const canvasW = Math.max(levelW, cols * tileSize);
  const canvasH = Math.max(levelH, rows * tileSize);
  const base = await sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).png().toBuffer();

  const composed = await sharp(base)
    .composite(composite)
    .resize(TARGET_W, null, { withoutEnlargement: true, fit: 'inside' })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(outPath);

  console.log(`Overview built for slide ${slide.id}: ${canvasW}x${canvasH} -> ${outPath} (${composed.width}x${composed.height}, ${composite.length} tiles from L${bestL})`);
  return `/uploads/overviews/${slide.id}.jpg`;
}

module.exports = { ensureOverview, OVERVIEW_DIR };
