/**
 * Fast pyramid generation for TIFF/JPEG/PNG/SVS via libvips (Sharp .tile).
 * Google layout on disk is {z}/{x}/{y}.jpg; we remap to the production
 * convention {level}/{col}_{row}.jpg so existing viewers keep working.
 */
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');

function calcMaxLevel(width, height, tileSize) {
  let maxLevel = 0;
  let w = width;
  let h = height;
  while (Math.max(w, h) > tileSize) {
    maxLevel += 1;
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
  }
  return maxLevel;
}

function expectedGrid(width, height, tileSize, serverLevel, maxLevel) {
  const scale = Math.pow(2, maxLevel - serverLevel);
  const levelWidth = Math.ceil(width / scale);
  const levelHeight = Math.ceil(height / scale);
  return {
    cols: Math.max(1, Math.ceil(levelWidth / tileSize)),
    rows: Math.max(1, Math.ceil(levelHeight / tileSize)),
    levelWidth,
    levelHeight
  };
}

/**
 * Move Sharp/libvips google tiles into {z}/{col}_{row}.jpg.
 * libvips google layout is {z}/{row}/{col}.jpg (y directory, x filename).
 */
async function relayoutGoogleTiles(googleDir, destDir) {
  if (!await fs.pathExists(googleDir)) {
    throw new Error(`google tile dir missing: ${googleDir}`);
  }
  const entries = await fs.readdir(googleDir, { withFileTypes: true });
  const levels = entries.filter(e => e.isDirectory() && /^\d+$/.test(e.name)).map(e => e.name);
  if (levels.length === 0) {
    throw new Error('sharp.tile produced no zoom levels');
  }
  await fs.ensureDir(destDir);
  let n = 0;
  for (const lv of levels) {
    const lvSrc = path.join(googleDir, lv);
    const lvDst = path.join(destDir, lv);
    await fs.ensureDir(lvDst);
    const xs = await fs.readdir(lvSrc, { withFileTypes: true });
    for (const xEnt of xs) {
      if (!xEnt.isDirectory() || !/^\d+$/.test(xEnt.name)) continue;
      const xDir = path.join(lvSrc, xEnt.name);
      const ys = await fs.readdir(xDir);
      for (const yFile of ys) {
        const m = yFile.match(/^(\d+)\.jpe?g$/i);
        if (!m) continue;
        const row = xEnt.name;
        const col = m[1];
        const dest = path.join(lvDst, `${col}_${row}.jpg`);
        await fs.move(path.join(xDir, yFile), dest, { overwrite: true });
        n += 1;
      }
    }
  }
  if (n === 0) {
    throw new Error('sharp.tile produced no jpeg tiles to remap');
  }
  return n;
}

async function generateCoarseLevels(sourcePath, tilesDir, width, height, tileSize, maxLevel, upToLevel = 0, sharpOpts = {}) {
  const last = Math.max(0, Math.min(upToLevel, maxLevel));
  const open = { limitInputPixels: false, sequentialRead: true, ...sharpOpts };
  for (let level = 0; level <= last; level++) {
    const { cols, rows, levelWidth, levelHeight } = expectedGrid(width, height, tileSize, level, maxLevel);
    const levelDir = path.join(tilesDir, String(level));
    await fs.ensureDir(levelDir);
    const tmp = path.join(tilesDir, `_preview_${level}.jpg`);
    await sharp(sourcePath, open)
      .resize(levelWidth, levelHeight, { fit: 'fill', withoutEnlargement: false })
      .jpeg({ quality: 80 })
      .toFile(tmp);
    const batch = [];
    const flush = async () => {
      const jobs = batch.splice(0, batch.length);
      await Promise.all(jobs);
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        batch.push(extractPaddedTile(tmp, path.join(levelDir, `${c}_${r}.jpg`), c, r, tileSize, levelWidth, levelHeight));
        if (batch.length >= 16) await flush();
      }
    }
    await flush();
    await fs.remove(tmp).catch(() => {});
  }
}

async function extractPaddedTile(levelImagePath, outputPath, col, row, tileSize, levelWidth, levelHeight) {
  const left = col * tileSize;
  const top = row * tileSize;
  if (left >= levelWidth || top >= levelHeight) return;
  const extractWidth = Math.min(tileSize, levelWidth - left);
  const extractHeight = Math.min(tileSize, levelHeight - top);
  try {
    if (extractWidth === tileSize && extractHeight === tileSize) {
      await sharp(levelImagePath)
        .extract({ left, top, width: extractWidth, height: extractHeight })
        .jpeg({ quality: 80 })
        .toFile(outputPath);
      return;
    }
    const tile = await sharp(levelImagePath)
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });
    await sharp({
      create: {
        width: tileSize,
        height: tileSize,
        channels: 3,
        background: { r: 240, g: 240, b: 240 }
      }
    })
      .composite([{
        input: tile.data,
        raw: { width: tile.info.width, height: tile.info.height, channels: 3 },
        left: 0,
        top: 0
      }])
      .jpeg({ quality: 80 })
      .toFile(outputPath);
  } catch (e) {
    await sharp({
      create: {
        width: tileSize,
        height: tileSize,
        channels: 3,
        background: { r: 240, g: 240, b: 240 }
      }
    })
      .jpeg({ quality: 75 })
      .toFile(outputPath);
  }
}

/**
 * Full pyramid using libvips dzsave (google layout) + remap.
 * Falls back to per-level Sharp extract if tile() fails (unusual formats).
 */
async function generatePyramid(sourcePath, tilesDir, width, height, tileSize, onProgress, sharpOpts = {}) {
  const maxLevel = calcMaxLevel(width, height, tileSize);
  await fs.ensureDir(tilesDir);
  const tmpGoogle = `${tilesDir}__google_tmp`;
  await fs.remove(tmpGoogle);
  const open = { limitInputPixels: false, sequentialRead: true, ...sharpOpts };

  try {
    if (onProgress) await onProgress(20, 'Building multi-resolution tiles…');
    await sharp(sourcePath, open)
      .jpeg({ quality: 80 })
      .tile({
        size: tileSize,
        overlap: 0,
        layout: 'google',
        depth: 'onetile'
      })
      .toFile(tmpGoogle);
    if (onProgress) await onProgress(75, 'Arranging tile grid…');
    const n = await relayoutGoogleTiles(tmpGoogle, tilesDir);
    await fs.remove(tmpGoogle).catch(() => {});
    return { maxLevel, nTiles: n, engine: 'sharp.tile' };
  } catch (err) {
    console.error('[pyramid] sharp.tile failed, using extract fallback:', err.message);
    await fs.remove(tmpGoogle).catch(() => {});
    if (onProgress) await onProgress(25, 'Building tiles (fallback)…');
    await generateCoarseLevels(sourcePath, tilesDir, width, height, tileSize, maxLevel, maxLevel, sharpOpts);
    if (onProgress) await onProgress(85, 'Fallback pyramid complete');
    return { maxLevel, nTiles: null, engine: 'extract-fallback' };
  }
}

/**
 * Pick the true WSI page from a multi-page TIFF/SVS (largest), not a ~4000px
 * overview page. Optional SLIDE_MAX_PIXELS cap avoids pathological RAM use.
 */
function pickSourcePage(pages) {
  if (!pages || pages.length === 0) return null;
  const cap = Number(process.env.SLIDE_MAX_PIXELS || 0);
  const ranked = [...pages].sort((a, b) => (b.width * b.height) - (a.width * a.height));
  if (cap > 0) {
    const under = ranked.find(p => p.width * p.height <= cap);
    if (under) return under;
  }
  return ranked[0];
}

/** Smallest page whose width is at least neededWidth (avoid upscaling). */
function pickPageForNeededWidth(pages, neededWidth) {
  if (!pages || pages.length === 0) return null;
  const ranked = [...pages].sort((a, b) => a.width - b.width);
  return ranked.find(p => p.width >= neededWidth) || ranked[ranked.length - 1];
}

function pyramidMetaPath(tilesDir) {
  return path.join(tilesDir, 'pyramid.json');
}

async function writePyramidMeta(tilesDir, meta) {
  await fs.ensureDir(tilesDir);
  await fs.writeJson(pyramidMetaPath(tilesDir), meta);
}

async function readPyramidMeta(tilesDir) {
  const p = pyramidMetaPath(tilesDir);
  if (!await fs.pathExists(p)) return null;
  try {
    return await fs.readJson(p);
  } catch (e) {
    return null;
  }
}

/**
 * One 256px JPEG at server level/col/row. Uses the closest TIFF/SVS page
 * when available so we do not decode the full-resolution plane for coarse tiles.
 */
async function generateOneTile(sourcePath, destPath, opts) {
  const {
    level,
    col,
    row,
    tileSize = 256,
    maxLevel,
    sourceWidth,
    sourceHeight,
    sourcePage = null,
    pages = null
  } = opts;

  const scale = 2 ** (maxLevel - level);
  const srcTile = tileSize * scale;
  const fullLeft = col * srcTile;
  const fullTop = row * srcTile;
  if (fullLeft >= sourceWidth || fullTop >= sourceHeight) return false;

  const levelWidth = Math.ceil(sourceWidth / scale);
  const levelHeight = Math.ceil(sourceHeight / scale);
  const tw = Math.min(tileSize, levelWidth - col * tileSize);
  const th = Math.min(tileSize, levelHeight - row * tileSize);
  if (tw < 1 || th < 1) return false;

  let page = sourcePage;
  let pageW = sourceWidth;
  let pageH = sourceHeight;
  if (Array.isArray(pages) && pages.length > 0) {
    const chosen = pickPageForNeededWidth(pages, levelWidth);
    if (chosen) {
      page = chosen.page;
      pageW = chosen.width;
      pageH = chosen.height;
    }
  }

  const sx = pageW / sourceWidth;
  const sy = pageH / sourceHeight;
  const left = Math.max(0, Math.min(pageW - 1, Math.floor(fullLeft * sx)));
  const top = Math.max(0, Math.min(pageH - 1, Math.floor(fullTop * sy)));
  const width = Math.max(1, Math.min(pageW - left, Math.ceil(srcTile * sx)));
  const height = Math.max(1, Math.min(pageH - top, Math.ceil(srcTile * sy)));

  const open = { limitInputPixels: false };
  if (page != null) open.page = page;

  await fs.ensureDir(path.dirname(destPath));
  try {
    let pipeline = sharp(sourcePath, open)
      .extract({ left, top, width, height })
      .resize(tw, th, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
    if (tw < tileSize || th < tileSize) {
      pipeline = pipeline.extend({
        top: 0,
        left: 0,
        right: tileSize - tw,
        bottom: tileSize - th,
        background: { r: 240, g: 240, b: 240 }
      });
    }
    await pipeline.jpeg({ quality: 80 }).toFile(destPath);
    return true;
  } catch (e) {
    await sharp({
      create: {
        width: tileSize,
        height: tileSize,
        channels: 3,
        background: { r: 240, g: 240, b: 240 }
      }
    }).jpeg({ quality: 75 }).toFile(destPath);
    return false;
  }
}

async function generateOverviewFromSource(sourcePath, destPath, opts = {}) {
  const maxEdge = opts.maxEdge || 1600;
  const pages = opts.pages;
  let page = opts.sourcePage;
  if (pages && pages.length) {
    const chosen = pickPageForNeededWidth(pages, maxEdge);
    if (chosen) page = chosen.page;
  }
  const open = { limitInputPixels: false, sequentialRead: true };
  if (page != null) open.page = page;
  await fs.ensureDir(path.dirname(destPath));
  await sharp(sourcePath, open)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(destPath);
}

module.exports = {
  calcMaxLevel,
  expectedGrid,
  relayoutGoogleTiles,
  generateCoarseLevels,
  generatePyramid,
  pickSourcePage,
  pickPageForNeededWidth,
  extractPaddedTile,
  generateOneTile,
  generateOverviewFromSource,
  writePyramidMeta,
  readPyramidMeta,
  pyramidMetaPath
};
