/**
 * slideProcessor.js — Shared slide processing pipeline.
 * Web upload and directory auto-import use this same tiling path.
 *
 * TIFF/JPEG/PNG/SVS: libvips Sharp .tile (google layout remapped to col_row).
 * KFB/KFBIO: vendor decoder via kfb_extract.py (coarse-first, stream progress).
 */
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { setProgress, setError, markViewable, markComplete } = require('./slideProgress');
const { generatePyramid, generateCoarseLevels, pickSourcePage, calcMaxLevel } = require('./pyramid');

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
    if (isMultiPageTiff) {
      const pages = await listTiffPages(filePath);
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

    await setProgress(slideId, 12, 'Generating thumbnail…');
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

    // Coarse levels first → viewer can open while the full pyramid builds.
    await setProgress(slideId, 18, 'Building overview tiles…');
    const previewUntil = Math.min(2, maxLevel);
    await generateCoarseLevels(processFilePath, tilesDir, width, height, tileSize, maxLevel, previewUntil, sharpOpts);
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

    await setProgress(slideId, 92, 'Building overview…');
    await markComplete(slideId, {
      width,
      height,
      maxLevel: result.maxLevel,
      thumbnailPath,
      tilesVersion: 1
    });
    await ensureOverviewSafe(slideId, true);
    console.log(`Slide ${slideId} processed successfully`);
  } catch (error) {
    console.error(`Error processing slide ${slideId}:`, error);
    await setError(slideId, error.message);
  }
}

async function processKfbSlide(slideId, filePath, uploadsDir, tilesDir) {
  const { processKFB, makeThumbnail } = require('./kfbProcessor');
  await setProgress(slideId, 5, 'Opening KFB with native decoder…');

  let header = null;
  let markedViewable = false;

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
      if (evt.event === 'header') {
        header = evt;
        await setProgress(slideId, 10, `KFB ${evt.width}×${evt.height}, ${evt.maxLevel + 1} zoom levels`);
      } else if (evt.event === 'progress') {
        await setProgress(slideId, evt.pct || 15, evt.msg || 'Decoding KFB…');
        if (evt.viewable) await markPreview();
      }
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
