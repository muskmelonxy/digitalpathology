/**
 * slideProcessor.js — Shared slide processing pipeline.
 * Web upload and directory auto-import use this same tiling path.
 *
 * TIFF/JPEG/PNG/SVS: overview + coarsest tiles immediately; remaining 256px
 *   JPEGs are extracted on demand (optional SLIDE_PREBUILD_PYRAMID=1 restores
 *   a full on-disk pyramid).
 * KFB/KFBIO: vendor decoder preview (label/macro/thumbnail + level 0) then
 *   on-demand tiles via a persistent worker — no full-file convert wait.
 */
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { setProgress, setError, markViewable, markComplete } = require('./slideProgress');
const {
  generatePyramid,
  generateCoarseLevels,
  pickSourcePage,
  calcMaxLevel,
  writePyramidMeta,
  generateOverviewFromSource
} = require('./pyramid');

function prebuildEnabled() {
  return process.env.SLIDE_PREBUILD_PYRAMID === '1';
}

const SUPPORTED_FORMATS = ['.tiff', '.tif', '.jpg', '.jpeg', '.png', '.kfb', '.kfbio', '.svs'];

async function readKFBIOHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(256);
    fs.readSync(fd, header, 0, 256, 0);
    fs.closeSync(fd);
    const width = header.readUInt32LE(0x10);
    const height = header.readUInt32LE(0x14);
    if (width > 1000 && width < 100000 && height > 1000 && height < 100000) {
      return { width, height, valid: true };
    }
    return { width: 0, height: 0, valid: false };
  } catch (error) {
    console.error('Error reading KFBIO header:', error.message);
    return { width: 0, height: 0, valid: false };
  }
}

async function listTiffPages(filePath) {
  const pages = [];
  try {
    const fullMeta = await sharp(filePath, { limitInputPixels: false }).metadata();
    const n = fullMeta.pages || 1;
    if (n <= 1) {
      if (fullMeta.width && fullMeta.height) {
        pages.push({ page: 0, width: fullMeta.width, height: fullMeta.height });
      }
      return pages;
    }
    for (let p = 0; p < n; p++) {
      try {
        const pageMeta = await sharp(filePath, { page: p, limitInputPixels: false }).metadata();
        pages.push({ page: p, width: pageMeta.width, height: pageMeta.height });
      } catch (e) {
        console.log(`Page ${p} metadata read failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.log('Multi-page detection skipped:', e.message);
  }
  return pages;
}

async function ensureOverviewSafe(slideId, force = false) {
  try {
    const { ensureOverview } = require('./overview');
    const { get } = require('../database');
    const row = await get('SELECT * FROM slides WHERE id = ?', [slideId]);
    if (row) await ensureOverview(row, { force });
  } catch (overviewErr) {
    console.error(`Overview post-build failed slide ${slideId}:`, overviewErr.message);
  }
}

/**
 * Generate pyramid tiles + thumbnail for a slide and update the DB row.
 */
async function processSlide(slideId, filePath, format, tileSize = 256) {
  const uploadsDir = path.join(__dirname, '../../uploads');
  const tilesDir = path.join(uploadsDir, 'tiles', slideId.toString());
  const thumbnailDir = path.join(uploadsDir, 'thumbnails');
  tileSize = parseInt(tileSize, 10) || 256;

  try {
    await fs.ensureDir(tilesDir);
    await fs.ensureDir(thumbnailDir);
    await setProgress(slideId, 2, 'Queued for processing…');

    let processFilePath = filePath;
    let metadata = null;
    let sharpOpts = {};

    if (format === 'kfb' || format === 'kfbio') {
      await processKfbSlide(slideId, filePath, uploadsDir, tilesDir);
      return;
    }

    const isMultiPageTiff = (format === 'svs' || format === 'tiff' || format === 'tif');
    let pages = [];
    if (isMultiPageTiff) {
      pages = await listTiffPages(filePath);
      console.log(`TIFF/SVS pages:`, pages.map(p => `${p.page}:${p.width}x${p.height}`).join(', ') || '(single)');
      const chosen = pickSourcePage(pages);
      if (chosen) {
        sharpOpts = { page: chosen.page };
        console.log(`Using page ${chosen.page} (${chosen.width}x${chosen.height}) as WSI source`);
      }
    }

    const image = sharp(processFilePath, { limitInputPixels: false, sequentialRead: true, ...sharpOpts });
    metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) {
      throw new Error('Could not read image dimensions');
    }
    const maxLevel = calcMaxLevel(width, height, tileSize);
    console.log(`Working resolution: ${width}x${height} maxLevel=${maxLevel}`);

    const sourcePage = sharpOpts.page != null ? sharpOpts.page : null;

    await writePyramidMeta(tilesDir, {
      width,
      height,
      tileSize,
      maxLevel,
      tile_mode: prebuildEnabled() ? 'prebuilt' : 'ondemand',
      source: 'sharp',
      source_page: sourcePage,
      pages: pages.length ? pages : undefined
    });

    await setProgress(slideId, 12, 'Generating overview…');
    const overviewPath = path.join(uploadsDir, 'overviews', `${slideId}.jpg`);
    try {
      await generateOverviewFromSource(processFilePath, overviewPath, {
        maxEdge: 1600,
        sourcePage,
        pages: pages.length ? pages : null
      });
    } catch (ovErr) {
      console.error('Overview from source failed:', ovErr.message);
    }

    let thumbnailPath = `/uploads/thumbnails/${slideId}.jpg`;
    try {
      await sharp(processFilePath, { limitInputPixels: false, ...sharpOpts })
        .resize(400, 400, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toFile(path.join(thumbnailDir, `${slideId}.jpg`));
    } catch (thumbErr) {
      console.error('Thumbnail generation failed:', thumbErr.message);
      thumbnailPath = null;
    }

    // Coarsest level only — home view is instant; other zoom levels on demand.
    await setProgress(slideId, 35, 'Building overview tiles…');
    await generateCoarseLevels(processFilePath, tilesDir, width, height, tileSize, maxLevel, 0, sharpOpts);

    if (prebuildEnabled()) {
      await markViewable(slideId, {
        width,
        height,
        maxLevel,
        thumbnailPath,
        tilesVersion: 1,
        message: 'Preview ready — generating remaining zoom levels…'
      });
      await ensureOverviewSafe(slideId);
      const result = await generatePyramid(processFilePath, tilesDir, width, height, tileSize, async (pct, msg) => {
        await setProgress(slideId, pct, msg);
      }, sharpOpts);
      console.log(`Pyramid engine=${result.engine} tiles=${result.nTiles} maxLevel=${result.maxLevel}`);
      await writePyramidMeta(tilesDir, {
        width, height, tileSize, maxLevel: result.maxLevel,
        tile_mode: 'prebuilt', source: 'sharp', source_page: sourcePage,
        pages: pages.length ? pages : undefined
      });
    }

    await markComplete(slideId, {
      width,
      height,
      maxLevel,
      thumbnailPath,
      tilesVersion: 1
    });
    await ensureOverviewSafe(slideId, false);
    console.log(`Slide ${slideId} processed successfully (ondemand=${!prebuildEnabled()})`);
  } catch (error) {
    console.error(`Error processing slide ${slideId}:`, error);
    await setError(slideId, error.message);
  }
}

async function processKfbSlide(slideId, filePath, uploadsDir, tilesDir) {
  const { processKFB, previewKFB } = require('./kfbProcessor');
  await setProgress(slideId, 5, 'Opening KFB with native decoder…');

  const onProgress = async (evt) => {
    if (evt.event === 'header') {
      await setProgress(slideId, 10, `KFB ${evt.width}×${evt.height}, ${(evt.maxLevel || 0) + 1} zoom levels`);
    } else if (evt.event === 'progress') {
      await setProgress(slideId, evt.pct || 15, evt.msg || 'Decoding KFB…');
    }
  };

  if (!prebuildEnabled()) {
    const meta = await previewKFB(slideId, filePath, uploadsDir, { onProgress });
    await markComplete(slideId, {
      width: meta.width,
      height: meta.height,
      maxLevel: meta.maxLevel,
      thumbnailPath: meta.thumbnailPath || `/uploads/thumbnails/${slideId}.jpg`,
      microPerPx: meta.capRes || null,
      tilesVersion: 1
    });
    await ensureOverviewSafe(slideId, false);
    console.log(`KFB slide ${slideId} preview-ready: ${meta.width}x${meta.height} maxLevel=${meta.maxLevel} (on-demand tiles)`);
    // Prebuild low/mid zoom from overview so first pan is instant.
    setImmediate(() => {
      const { prebuildKfbCoarseLevels } = require('./tileServe');
      prebuildKfbCoarseLevels(slideId, meta.width, meta.height, meta.maxLevel, 256)
        .then((r) => console.log(`[kfb] coarse prebuild slide ${slideId}: ${r.tiles} tiles in ${r.ms}ms`))
        .catch((e) => console.error(`[kfb] coarse prebuild failed slide ${slideId}:`, e.message));
    });
    // Warm native decoder for high-zoom tiles.
    setImmediate(() => {
      try {
        const { getSession } = require('./kfbWorker');
        getSession(filePath).opened
          .then(() => console.log(`[kfb] worker warmed for slide ${slideId}`))
          .catch((e) => console.error(`[kfb] worker warm failed slide ${slideId}:`, e.message));
      } catch (e) {
        console.error(`[kfb] worker warm error slide ${slideId}:`, e.message);
      }
    });
    return;
  }

  let header = null;
  let markedViewable = false;
  const { makeThumbnail } = require('./kfbProcessor');
  const markPreview = async () => {
    if (markedViewable || !header) return;
    markedViewable = true;
    const thumb = await makeThumbnail(header, slideId, tilesDir, path.join(uploadsDir, 'thumbnails'));
    await markViewable(slideId, {
      width: header.width,
      height: header.height,
      maxLevel: header.maxLevel,
      thumbnailPath: thumb || `/uploads/thumbnails/${slideId}.jpg`,
      microPerPx: header.capRes || null,
      tilesVersion: 1,
      message: 'KFB preview ready — decoding remaining zoom levels…'
    });
    await ensureOverviewSafe(slideId);
  };

  const meta = await processKFB(slideId, filePath, uploadsDir, {
    onProgress: async (evt) => {
      await onProgress(evt);
      if (evt.event === 'header') header = evt;
      if (evt.viewable) await markPreview();
    }
  });

  await markComplete(slideId, {
    width: meta.width,
    height: meta.height,
    maxLevel: meta.maxLevel,
    thumbnailPath: meta.thumbnailPath || `/uploads/thumbnails/${slideId}.jpg`,
    microPerPx: meta.capRes || null,
    tilesVersion: 1
  });
  await ensureOverviewSafe(slideId, true);
  console.log(`KFB slide ${slideId} processed: ${meta.width}x${meta.height} maxLevel=${meta.maxLevel} tiles=${meta.nTiles}`);
}

module.exports = {
  SUPPORTED_FORMATS,
  readKFBIOHeader,
  processSlide
};
