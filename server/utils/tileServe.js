/**
 * On-demand 256px JPEG tiles. Cache hits are served from disk with a 7-day
 * Cache-Control; misses are generated from the original WSI (Sharp extract or
 * the persistent KFB worker) and then cached.
 */
const path = require('path');
const fs = require('fs-extra');
const { get } = require('../database');
const { expectedGrid, generateOneTile, readPyramidMeta } = require('./pyramid');
const { extractKfbTile } = require('./kfbWorker');

const TILES_ROOT = path.join(__dirname, '../../uploads/tiles');
const SLIDES_ROOT = path.join(__dirname, '../../uploads/slides');
const TILE_RE = /^\/(\d+)\/(\d+)\/(\d+)_(\d+)\.jpe?g$/i;
const SHARP_CONCURRENCY = Math.max(1, Number(process.env.TILE_GEN_CONCURRENCY || 4));

const inflight = new Map();
const slideCache = new Map();
let sharpActive = 0;
const sharpWaiters = [];

function withSharpLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      sharpActive += 1;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        sharpActive -= 1;
        const next = sharpWaiters.shift();
        if (next) next();
      }
    };
    if (sharpActive >= SHARP_CONCURRENCY) sharpWaiters.push(run);
    else run();
  });
}

async function loadSlide(id) {
  const hit = slideCache.get(id);
  if (hit && Date.now() - hit.t < 8000) return hit.row;
  const row = await get('SELECT * FROM slides WHERE id = ?', [id]);
  if (row) slideCache.set(id, { t: Date.now(), row });
  return row;
}

function tilePath(slideId, level, col, row) {
  return path.join(TILES_ROOT, String(slideId), String(level), `${col}_${row}.jpg`);
}

function isKfb(slide) {
  const f = String(slide.original_format || '').toLowerCase();
  const name = String(slide.filename || '').toLowerCase();
  return f === 'kfb' || f === 'kfbio' || name.endsWith('.kfb') || name.endsWith('.kfbio');
}

function sourcePathFor(slide) {
  return path.join(SLIDES_ROOT, slide.filename);
}


async function generateKfbOverviewTile({ slideId, level, col, row, tileSize, maxLevel, width, height, dest }) {
  const sharp = require('sharp');
  const candidates = [
    path.join(__dirname, '../../uploads/overviews', `${slideId}.jpg`),
    path.join(__dirname, '../../uploads/thumbnails', `${slideId}.jpg`)
  ];
  // Use WSI overview/thumbnail only — cassette macros have a different coordinate frame.
  let overview = null;
  let bestPixels = -1;
  for (const c of candidates) {
    if (!(await fs.pathExists(c))) continue;
    try {
      const m = await sharp(c).metadata();
      const px = (m.width || 0) * (m.height || 0);
      if (px > bestPixels) { bestPixels = px; overview = c; }
    } catch (e) {
      if (!overview) overview = c;
    }
  }
  if (!overview) {
    const err = new Error('kfb overview missing');
    err.status = 404;
    throw err;
  }
  const d = 2 ** (maxLevel - level);
  const levelWidth = Math.max(1, Math.ceil(width / d));
  const levelHeight = Math.max(1, Math.ceil(height / d));
  const meta = await sharp(overview).metadata();
  const ow = meta.width || 1;
  const oh = meta.height || 1;
  const left = Math.floor((col * tileSize * ow) / levelWidth);
  const top = Math.floor((row * tileSize * oh) / levelHeight);
  const right = Math.ceil((Math.min(levelWidth, (col + 1) * tileSize) * ow) / levelWidth);
  const bottom = Math.ceil((Math.min(levelHeight, (row + 1) * tileSize) * oh) / levelHeight);
  const extractLeft = Math.max(0, Math.min(left, ow - 1));
  const extractTop = Math.max(0, Math.min(top, oh - 1));
  const extractWidth = Math.max(1, Math.min(right - extractLeft, ow - extractLeft));
  const extractHeight = Math.max(1, Math.min(bottom - extractTop, oh - extractTop));
  await fs.ensureDir(path.dirname(dest));
  const tmp = `${dest}.tmp.jpg`;
  await sharp(overview)
    .extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight })
    .resize(tileSize, tileSize, { fit: 'fill' })
    .jpeg({ quality: 85 })
    .toFile(tmp);
  await fs.move(tmp, dest, { overwrite: true });
  return dest;
}

async function ensureTile(slideId, level, col, row) {
  const dest = tilePath(slideId, level, col, row);
  if (await fs.pathExists(dest)) return dest;

  const key = `${slideId}/${level}/${col}_${row}`;
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const slide = await loadSlide(slideId);
    if (!slide || slide.status !== 'ready') {
      const err = new Error('slide not ready');
      err.status = 404;
      throw err;
    }
    const tilesDir = path.join(TILES_ROOT, String(slideId));
    const meta = (await readPyramidMeta(tilesDir)) || {};
    const width = meta.width || slide.width;
    const height = meta.height || slide.height;
    const tileSize = meta.tileSize || slide.tile_size || 256;
    const maxLevel = meta.maxLevel != null ? meta.maxLevel : slide.max_level;
    if (!width || !height || maxLevel == null) {
      const err = new Error('missing pyramid metadata');
      err.status = 404;
      throw err;
    }
    const grid = expectedGrid(width, height, tileSize, Number(level), maxLevel);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
      const err = new Error('tile out of range');
      err.status = 404;
      throw err;
    }

    const src = sourcePathFor(slide);
    if (!await fs.pathExists(src)) {
      const err = new Error('source file missing');
      err.status = 404;
      throw err;
    }

    if (isKfb(slide)) {
      const lv = Number(level);
      // Coarse levels: crop associated overview (vendor fscale<1 ROIs are broken).
      // Native level: decode 256px tiles at fscale=1.0 via the KFB worker.
      if (lv < maxLevel) {
        await withSharpLimit(() => generateKfbOverviewTile({
          slideId,
          level: lv,
          col,
          row,
          tileSize,
          maxLevel,
          width,
          height,
          dest
        }));
      } else {
        await extractKfbTile(src, lv, col, row, dest);
      }
    } else {
      await withSharpLimit(() => generateOneTile(src, dest, {
        level: Number(level),
        col,
        row,
        tileSize,
        maxLevel,
        sourceWidth: width,
        sourceHeight: height,
        sourcePage: meta.source_page != null ? meta.source_page : undefined,
        pages: meta.pages || null
      }));
    }
    if (!await fs.pathExists(dest)) {
      const err = new Error('tile generation produced no file');
      err.status = 404;
      throw err;
    }
    return dest;
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

function sendJpeg(res, filePath) {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.sendFile(path.resolve(filePath));
}

async function tileMiddleware(req, res, next) {
  const m = String(req.path || '').match(TILE_RE);
  if (!m) {
    res.status(404);
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text').send('Not found');
  }
  const slideId = Number(m[1]);
  const level = Number(m[2]);
  const col = Number(m[3]);
  const row = Number(m[4]);
  try {
    const dest = tilePath(slideId, level, col, row);
    if (await fs.pathExists(dest)) {
      return sendJpeg(res, dest);
    }
    const generated = await ensureTile(slideId, level, col, row);
    return sendJpeg(res, generated);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[tiles]', e.message);
    res.status(status);
    res.setHeader('Cache-Control', 'no-store');
    if (status === 404) return res.type('text').send('Not found');
    return res.type('text').send('Tile error');
  }
}

module.exports = { tileMiddleware, ensureTile, tilePath };
