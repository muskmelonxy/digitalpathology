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
  return f === 'kfb' || f === 'kfbio';
}

function sourcePathFor(slide) {
  return path.join(SLIDES_ROOT, slide.filename);
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
      await extractKfbTile(src, Number(level), col, row, dest);
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
