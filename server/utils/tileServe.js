/**
 * On-demand 256px JPEG tiles. Cache hits are served from disk with a 7-day
 * Cache-Control; misses are generated from the original WSI (Sharp extract or
 * the persistent KFB worker) and then cached.
 *
 * KFB zoom strategy
 * -----------------
 * Vendor GetImageDataRoiFunc with fscale<1 returns broken corner-stamped
 * thumbs. True native tiles use fscale=header_scale (e.g. 40) with full-res
 * pixel coords (col*256,row*256) via the KFB worker — NOT fscale=1.0 tile
 * indices (that only addresses ~W/scale and looks soft).
 *
 * Overview crops are ONLY used when the overview has enough resolution for
 * that level — i.e. overviewWidth >= ceil(slideWidth / 2^(maxLevel-level))
 * (and same for height). For slide 22 (32450×24648, overview 1600×1214,
 * maxLevel 7) that means levels 0–2 only. Mid levels assemble a grid of
 * native 256 tiles, then lanczos3-downscale to 256 (no huge ROI).
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
const NATIVE_FETCH_CONCURRENCY = Math.max(1, Number(process.env.KFB_NATIVE_FETCH_CONCURRENCY || 6));

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

async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
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

/**
 * True when overview has >= the level plane resolution, so a crop is not a
 * soft digital zoom of a low-res thumb.
 * Threshold: ow >= ceil(width / 2^(maxLevel-level)) && oh >= ceil(height / …).
 */
function overviewCoversLevel(ow, oh, width, height, maxLevel, level) {
  const d = 2 ** (maxLevel - level);
  const needW = Math.max(1, Math.ceil(width / d));
  const needH = Math.max(1, Math.ceil(height / d));
  return ow >= needW && oh >= needH;
}

/** Highest level (inclusive) that may use overview crops; -1 if none. */
function maxOverviewSafeLevel(ow, oh, width, height, maxLevel) {
  let best = -1;
  for (let level = 0; level < maxLevel; level++) {
    if (overviewCoversLevel(ow, oh, width, height, maxLevel, level)) best = level;
    else break;
  }
  return best;
}

async function resolveOverviewPath(slideId) {
  const sharp = require('sharp');
  const candidates = [
    path.join(__dirname, '../../uploads/overviews', `${slideId}.jpg`),
    path.join(__dirname, '../../uploads/thumbnails', `${slideId}.jpg`)
  ];
  let overview = null;
  let bestPixels = -1;
  let meta = null;
  for (const c of candidates) {
    if (!(await fs.pathExists(c))) continue;
    try {
      const m = await sharp(c).metadata();
      const px = (m.width || 0) * (m.height || 0);
      if (px > bestPixels) {
        bestPixels = px;
        overview = c;
        meta = m;
      }
    } catch (e) {
      if (!overview) overview = c;
    }
  }
  return { overview, meta };
}

/**
 * Pre-generate overview-safe coarse levels only (fast disk cache for far zoom).
 * Mid levels are NOT built from the overview — that looked like soft digital zoom.
 * Optionally schedules a background full-res prebuild for the next 1–2 mid levels.
 */
async function prebuildKfbCoarseLevels(slideId, width, height, maxLevel, tileSize = 256) {
  const sharp = require('sharp');
  const { overview, meta } = await resolveOverviewPath(slideId);
  if (!overview) throw new Error(`no overview for slide ${slideId}`);

  const ow = (meta && meta.width) || (await sharp(overview).metadata()).width || 1;
  const oh = (meta && meta.height) || (await sharp(overview).metadata()).height || 1;
  const safeMax = maxOverviewSafeLevel(ow, oh, width, height, maxLevel);
  let n = 0;
  const t0 = Date.now();

  // Documented threshold: only levels where overview covers the level plane.
  for (let level = 0; level <= safeMax; level++) {
    const d = 2 ** (maxLevel - level);
    const levelWidth = Math.max(1, Math.ceil(width / d));
    const levelHeight = Math.max(1, Math.ceil(height / d));
    const cols = Math.max(1, Math.ceil(levelWidth / tileSize));
    const rows = Math.max(1, Math.ceil(levelHeight / tileSize));
    const levelDir = path.join(TILES_ROOT, String(slideId), String(level));
    await fs.ensureDir(levelDir);

    const jobs = [];
    const flush = async () => {
      const batch = jobs.splice(0, jobs.length);
      await Promise.all(batch);
    };

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const dest = path.join(levelDir, `${col}_${row}.jpg`);
        if (await fs.pathExists(dest)) { n += 1; continue; }
        const left = Math.floor((col * tileSize * ow) / levelWidth);
        const top = Math.floor((row * tileSize * oh) / levelHeight);
        const right = Math.ceil((Math.min(levelWidth, (col + 1) * tileSize) * ow) / levelWidth);
        const bottom = Math.ceil((Math.min(levelHeight, (row + 1) * tileSize) * oh) / levelHeight);
        const extractLeft = Math.max(0, Math.min(left, ow - 1));
        const extractTop = Math.max(0, Math.min(top, oh - 1));
        const extractWidth = Math.max(1, Math.min(right - extractLeft, ow - extractLeft));
        const extractHeight = Math.max(1, Math.min(bottom - extractTop, oh - extractTop));
        jobs.push((async () => {
          const tmp = `${dest}.tmp.jpg`;
          await sharp(overview)
            .extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight })
            .resize(tileSize, tileSize, { fit: 'fill' })
            .jpeg({ quality: 80 })
            .toFile(tmp);
          await fs.move(tmp, dest, { overwrite: true });
          n += 1;
        })());
        if (jobs.length >= 32) await flush();
      }
    }
    await flush();
  }

  // Optional background: next 1–2 mid levels from full-res (set PREBUILD_KFB_MID=1).
  // Off by default — full mid prebuild can decode thousands of native tiles.
  if (String(process.env.PREBUILD_KFB_MID || '') === '1' && safeMax + 1 < maxLevel) {
    const midLevels = [];
    for (let lv = safeMax + 1; lv < maxLevel && midLevels.length < 2; lv++) midLevels.push(lv);
    setImmediate(() => {
      prebuildKfbMidLevelsFromFullRes(slideId, width, height, maxLevel, midLevels, tileSize)
        .then((r) => console.log(`[kfb] mid prebuild slide ${slideId} L[${midLevels.join(',')}]: ${r.tiles} tiles in ${r.ms}ms`))
        .catch((e) => console.error(`[kfb] mid prebuild failed slide ${slideId}:`, e.message));
    });
  }

  return { tiles: n, ms: Date.now() - t0, overview, overviewSafeMax: safeMax, overviewSize: `${ow}x${oh}` };
}

/**
 * Prebuild selected mid levels by assembling native tiles + downscale.
 * Skips tiles that already exist. Intended for background use.
 */
async function prebuildKfbMidLevelsFromFullRes(slideId, width, height, maxLevel, levels, tileSize = 256) {
  const slide = await loadSlide(slideId);
  if (!slide) throw new Error(`slide ${slideId} missing`);
  const src = sourcePathFor(slide);
  let n = 0;
  const t0 = Date.now();
  for (const level of levels) {
    if (level < 0 || level >= maxLevel) continue;
    const d = 2 ** (maxLevel - level);
    const levelWidth = Math.max(1, Math.ceil(width / d));
    const levelHeight = Math.max(1, Math.ceil(height / d));
    const cols = Math.max(1, Math.ceil(levelWidth / tileSize));
    const rows = Math.max(1, Math.ceil(levelHeight / tileSize));
    await fs.ensureDir(path.join(TILES_ROOT, String(slideId), String(level)));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const dest = tilePath(slideId, level, col, row);
        if (await fs.pathExists(dest)) { n += 1; continue; }
        try {
          await withSharpLimit(() => generateKfbDownscaleTile({
            slideId, src, level, col, row, tileSize, maxLevel, width, height, dest
          }));
          n += 1;
        } catch (e) {
          console.error(`[kfb] mid tile ${slideId}/${level}/${col}_${row}:`, e.message);
        }
      }
    }
  }
  return { tiles: n, ms: Date.now() - t0, levels };
}

async function generateKfbOverviewTile({ slideId, level, col, row, tileSize, maxLevel, width, height, dest }) {
  const sharp = require('sharp');
  const { overview, meta } = await resolveOverviewPath(slideId);
  if (!overview) {
    const err = new Error('kfb overview missing');
    err.status = 404;
    throw err;
  }
  const d = 2 ** (maxLevel - level);
  const levelWidth = Math.max(1, Math.ceil(width / d));
  const levelHeight = Math.max(1, Math.ceil(height / d));
  const ow = (meta && meta.width) || (await sharp(overview).metadata()).width || 1;
  const oh = (meta && meta.height) || (await sharp(overview).metadata()).height || 1;
  if (!overviewCoversLevel(ow, oh, width, height, maxLevel, level)) {
    const err = new Error(`overview too small for level ${level} (${ow}x${oh})`);
    err.status = 500;
    throw err;
  }
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

/**
 * Sharp mid-level tile: mosaic native 256px tiles, then lanczos3
 * downscale to 256. Prefers per-native downscale-then-composite when
 * tileSize/d is an integer (>=1) so we never decode one huge ROI.
 */
async function generateKfbDownscaleTile({ slideId, src, level, col, row, tileSize, maxLevel, width, height, dest }) {
  const sharp = require('sharp');
  const d = 2 ** (maxLevel - level);
  if (d <= 1) {
    await fs.ensureDir(path.dirname(dest));
    await extractKfbTile(src, maxLevel, col, row, dest);
    return dest;
  }

  const x0 = col * tileSize * d;
  const y0 = row * tileSize * d;
  const x1 = Math.min(width, x0 + tileSize * d);
  const y1 = Math.min(height, y0 + tileSize * d);
  const regionW = Math.max(1, x1 - x0);
  const regionH = Math.max(1, y1 - y0);

  const nc0 = Math.floor(x0 / tileSize);
  const nr0 = Math.floor(y0 / tileSize);
  const nc1 = Math.ceil(x1 / tileSize);
  const nr1 = Math.ceil(y1 / tileSize);

  const nativeMaxCol = Math.max(1, Math.ceil(width / tileSize));
  const nativeMaxRow = Math.max(1, Math.ceil(height / tileSize));

  const cells = [];
  for (let nr = nr0; nr < nr1; nr++) {
    for (let nc = nc0; nc < nc1; nc++) {
      if (nc < 0 || nr < 0 || nc >= nativeMaxCol || nr >= nativeMaxRow) continue;
      cells.push({ nc, nr });
    }
  }
  if (cells.length === 0) {
    const err = new Error('no native tiles for region');
    err.status = 404;
    throw err;
  }

  await mapPool(cells, NATIVE_FETCH_CONCURRENCY, async ({ nc, nr }) => {
    const p = tilePath(slideId, maxLevel, nc, nr);
    if (await fs.pathExists(p)) return;
    await fs.ensureDir(path.dirname(p));
    const tmp = `${p}.tmp.jpg`;
    await extractKfbTile(src, maxLevel, nc, nr, tmp);
    await fs.move(tmp, p, { overwrite: true });
  });

  await fs.ensureDir(path.dirname(dest));
  const tmpOut = `${dest}.tmp.jpg`;
  const cell = tileSize / d;

  if (Number.isInteger(cell) && cell >= 1) {
    // Downscale each native tile first, then composite — keeps memory small.
    const mosaicW = (nc1 - nc0) * cell;
    const mosaicH = (nr1 - nr0) * cell;
    const composites = await mapPool(cells, NATIVE_FETCH_CONCURRENCY, async ({ nc, nr }) => {
      const buf = await sharp(tilePath(slideId, maxLevel, nc, nr))
        .resize(cell, cell, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .jpeg({ quality: 95 })
        .toBuffer();
      return {
        input: buf,
        left: (nc - nc0) * cell,
        top: (nr - nr0) * cell
      };
    });

    const extractLeft = Math.max(0, Math.min(Math.floor((x0 - nc0 * tileSize) / d), mosaicW - 1));
    const extractTop = Math.max(0, Math.min(Math.floor((y0 - nr0 * tileSize) / d), mosaicH - 1));
    const extractWidth = Math.max(1, Math.min(Math.ceil(regionW / d), mosaicW - extractLeft));
    const extractHeight = Math.max(1, Math.min(Math.ceil(regionH / d), mosaicH - extractTop));

    let pipeline = sharp({
      create: {
        width: mosaicW,
        height: mosaicH,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    }).composite(composites);

    if (extractWidth !== mosaicW || extractHeight !== mosaicH || extractLeft || extractTop) {
      pipeline = pipeline.extract({
        left: extractLeft,
        top: extractTop,
        width: extractWidth,
        height: extractHeight
      });
    }

    await pipeline
      .resize(tileSize, tileSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: 85 })
      .toFile(tmpOut);
  } else {
    // Fallback: full-res mosaic in row strips (avoid one giant ROI / OOM).
    const mosaicW = (nc1 - nc0) * tileSize;
    const stripHeight = tileSize;
    const stripBufs = [];
    for (let nr = nr0; nr < nr1; nr++) {
      const rowInputs = [];
      for (let nc = nc0; nc < nc1; nc++) {
        if (nc < 0 || nr < 0 || nc >= nativeMaxCol || nr >= nativeMaxRow) continue;
        rowInputs.push({
          input: tilePath(slideId, maxLevel, nc, nr),
          left: (nc - nc0) * tileSize,
          top: 0
        });
      }
      const strip = await sharp({
        create: {
          width: mosaicW,
          height: stripHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
        .composite(rowInputs)
        .raw()
        .toBuffer();
      stripBufs.push(strip);
    }
    const mosaicH = stripBufs.length * stripHeight;
    const mosaic = Buffer.concat(stripBufs);
    const extractLeft = Math.max(0, Math.min(x0 - nc0 * tileSize, mosaicW - 1));
    const extractTop = Math.max(0, Math.min(y0 - nr0 * tileSize, mosaicH - 1));
    const extractWidth = Math.max(1, Math.min(regionW, mosaicW - extractLeft));
    const extractHeight = Math.max(1, Math.min(regionH, mosaicH - extractTop));
    await sharp(mosaic, { raw: { width: mosaicW, height: mosaicH, channels: 3 } })
      .extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight })
      .resize(tileSize, tileSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: 85 })
      .toFile(tmpOut);
  }

  await fs.move(tmpOut, dest, { overwrite: true });
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
      if (lv >= maxLevel) {
        // Native full-res: worker uses fscale=scan_scale + pixel coords.
        await extractKfbTile(src, maxLevel, col, row, dest);
      } else {
        const { overview, meta: ovMeta } = await resolveOverviewPath(slideId);
        const ow = ovMeta && ovMeta.width;
        const oh = ovMeta && ovMeta.height;
        const canOverview = overview && ow && oh && overviewCoversLevel(ow, oh, width, height, maxLevel, lv);
        if (canOverview) {
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
          // Mid zoom: assemble native tiles + lanczos3 downscale (sharp).
          await withSharpLimit(() => generateKfbDownscaleTile({
            slideId,
            src,
            level: lv,
            col,
            row,
            tileSize,
            maxLevel,
            width,
            height,
            dest
          }));
        }
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

module.exports = {
  tileMiddleware,
  ensureTile,
  tilePath,
  prebuildKfbCoarseLevels,
  prebuildKfbMidLevelsFromFullRes,
  generateKfbOverviewTile,
  generateKfbDownscaleTile,
  overviewCoversLevel,
  maxOverviewSafeLevel
};
