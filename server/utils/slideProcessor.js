/**
 * slideProcessor.js — Shared slide processing pipeline.
 * Extracted from routes/upload.js so both web upload and directory
 * auto-import use the identical tiling logic.
 */
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { run } = require('../database');

// Supported slide formats
const SUPPORTED_FORMATS = ['.tiff', '.tif', '.jpg', '.jpeg', '.png', '.kfb', '.kfbio', '.svs'];

/**
 * Read KFBIO file header to extract original dimensions
 */
async function readKFBIOHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(256);
    fs.readSync(fd, header, 0, 256, 0);
    fs.closeSync(fd);

    // Read dimensions from header (observed at offsets 0x10 and 0x14)
    const width = header.readUInt32LE(0x10);
    const height = header.readUInt32LE(0x14);

    // Validate dimensions
    if (width > 1000 && width < 100000 && height > 1000 && height < 100000) {
      return { width, height, valid: true };
    }

    return { width: 0, height: 0, valid: false };
  } catch (error) {
    console.error('Error reading KFBIO header:', error.message);
    return { width: 0, height: 0, valid: false };
  }
}

/**
 * Generate pyramid tiles + thumbnail for a slide and update the DB row.
 * @param {number} slideId   DB row id
 * @param {string} filePath  Path to the original slide file
 * @param {string} format    original format (e.g. 'svs', 'tiff', 'kfb')
 * @param {number} tileSize  tile size in px (default 256)
 */
async function processSlide(slideId, filePath, format, tileSize = 256) {
  const uploadsDir = path.join(__dirname, '../../uploads');
  const tilesDir = path.join(uploadsDir, 'tiles', slideId.toString());
  const thumbnailDir = path.join(uploadsDir, 'thumbnails');

  try {
    await fs.ensureDir(tilesDir);

    let image;
    let metadata;
    let processFilePath = filePath;
    let isKFBIOConverted = false;
    let kfbReady = false;      // kfb 已由官方解码器直接生成金字塔, 跳过 sharp 重切
    let kfbDims = null;
    let microPerPx = null;     // kfb 微米/像素 (尺标/倍率用)

    // For SVS/TIFF multi-page formats, pre-read all page dimensions
    let svsPages = [];
    const isMultiPageTiff = (format === 'svs' || format === 'tiff' || format === 'tif');

    if (isMultiPageTiff) {
      try {
        const fullMeta = await sharp(filePath, { limitInputPixels: false }).metadata();
        if (fullMeta.pages && fullMeta.pages > 1) {
          // Read each page's dimensions
          for (let p = 0; p < fullMeta.pages; p++) {
            try {
              const pageMeta = await sharp(filePath, { page: p, limitInputPixels: false }).metadata();
              svsPages.push({ page: p, width: pageMeta.width, height: pageMeta.height });
            } catch (e) {
              console.log(`Page ${p} metadata read failed: ${e.message}`);
            }
          }
          console.log(`Multi-page TIFF with ${svsPages.length} pages:`, svsPages.map(p => `${p.width}x${p.height}`).join(', '));
        }
      } catch (e) {
        console.log('Multi-page detection skipped:', e.message);
      }
    }

    // Select best source page and extract to temp file for multi-page TIFFs
    if (isMultiPageTiff && svsPages.length > 1) {
      // Choose page with resolution closest to 4000px wide (good balance of quality vs speed)
      let bestPage = 0;
      let bestDiff = Infinity;
      for (const p of svsPages) {
        const diff = Math.abs(p.width - 4000);
        if (diff < bestDiff) {
          bestPage = p.page;
          bestDiff = diff;
        }
      }
      // Extract the chosen page to a temp JPEG for processing
      const tempDir = path.join(uploadsDir, 'temp');
      await fs.ensureDir(tempDir);
      const extractedPath = path.join(tempDir, `${slideId}_source.jpg`);
      console.log(`Extracting page ${bestPage} (${svsPages[bestPage].width}x${svsPages[bestPage].height}) for processing...`);
      await sharp(filePath, { limitInputPixels: false, page: bestPage })
        .jpeg({ quality: 95 })
        .toFile(extractedPath);
      processFilePath = extractedPath;
      console.log('Extracted source page to temp file');
      // Re-read metadata from extracted page
      const extractedMeta = await sharp(processFilePath, { limitInputPixels: false }).metadata();
      console.log(`Working resolution: ${extractedMeta.width}x${extractedMeta.height}`);
      metadata = extractedMeta;
    }

    // Handle different formats
    if (format === 'kfb' || format === 'kfbio') {
      console.log(`Processing KFBIO (官方解码器): ${filePath}`);
      const { processKFB } = require('./kfbProcessor');
      try {
        const meta = await processKFB(slideId, filePath, uploadsDir);
        console.log(`KFBIO 解码完成: ${meta.width}x${meta.height}, maxLevel=${meta.maxLevel}, 瓦片=${meta.nTiles}`);
        kfbDims = { width: meta.width, height: meta.height, maxLevel: meta.maxLevel };
        microPerPx = meta.capRes || null;
        kfbReady = true;
        isKFBIOConverted = true;
      } catch (kfbError) {
        console.error('KFBIO 解码失败:', kfbError.message);
        throw new Error(`Unable to process KFBIO file: ${kfbError.message}`);
      }
    } else if (!isMultiPageTiff || svsPages.length <= 1) {
      // Standard single-page image formats
      image = sharp(filePath, { limitInputPixels: false, page: 0 });
      metadata = await image.metadata();
    }

    let width, height, maxLevel;
    if (!kfbReady) {
      width = metadata.width;
      height = metadata.height;

      // Calculate pyramid levels
      maxLevel = Math.ceil(Math.log2(Math.max(width, height) / tileSize));

      // Generate thumbnail from processFilePath
      console.log('Generating thumbnail...');
      try {
        await sharp(processFilePath, { limitInputPixels: false })
          .resize(400, 400, { fit: 'inside' })
          .jpeg({ quality: 80 })
          .toFile(path.join(thumbnailDir, `${slideId}.jpg`));
        console.log('Thumbnail generated');
      } catch (thumbErr) {
        console.error('Thumbnail generation failed:', thumbErr.message);
      }

      // Generate pyramid tiles
      for (let level = 0; level <= maxLevel; level++) {
      const levelDir = path.join(tilesDir, level.toString());
      await fs.ensureDir(levelDir);

      const scale = Math.pow(2, maxLevel - level);
      const levelWidth = Math.ceil(width / scale);
      const levelHeight = Math.ceil(height / scale);
      const cols = Math.ceil(levelWidth / tileSize);
      const rows = Math.ceil(levelHeight / tileSize);

      console.log(`Processing level ${level}: ${levelWidth}x${levelHeight}, ${cols}x${rows} tiles, scale=${scale}`);

      const levelImagePath = path.join(tilesDir, `_level_${level}.jpg`);

      try {
        await sharp(processFilePath, { limitInputPixels: false })
          .resize(levelWidth, levelHeight, {
            fit: 'fill',
            withoutEnlargement: false
          })
          .jpeg({ quality: 80 })
          .toFile(levelImagePath);

        // Extract tiles from the resized level image
        const batchSize = 10;
        for (let row = 0; row < rows; row += batchSize) {
          const promises = [];
          for (let r = row; r < Math.min(row + batchSize, rows); r++) {
            for (let c = 0; c < cols; c++) {
              promises.push(generateTileFromLevel(levelImagePath, levelDir, c, r, tileSize, levelWidth, levelHeight));
            }
          }
          await Promise.all(promises);
        }

        await fs.remove(levelImagePath);
      } catch (levelErr) {
        console.error(`Error processing level ${level}: ${levelErr.message}`);
        throw levelErr;
      }
      }
    } else {
      width = kfbDims.width;
      height = kfbDims.height;
      maxLevel = kfbDims.maxLevel;
    }

    // Clean up KFBIO temp file
    if (isKFBIOConverted && processFilePath !== filePath) {
      try { await fs.remove(processFilePath); } catch (e) {}
    }

    // Update database
    await run(
      `UPDATE slides SET status = 'ready', width = ?, height = ?, max_level = ?, thumbnail_path = ?, micro_per_px = ? WHERE id = ?`,
      [width, height, maxLevel, `/uploads/thumbnails/${slideId}.jpg`, microPerPx, slideId]
    );

    // Build a crisp whole-slide overview (best-effort, non-fatal)
    try {
      const { ensureOverview } = require('./overview');
      const { get } = require('../database');
      const row = await get('SELECT * FROM slides WHERE id = ?', [slideId]);
      await ensureOverview(row);
    } catch (overviewErr) {
      console.error(`Overview post-build failed slide ${slideId}:`, overviewErr.message);
    }

    console.log(`Slide ${slideId} processed successfully`);

  } catch (error) {
    console.error(`Error processing slide ${slideId}:`, error);
    await run(
      `UPDATE slides SET status = 'error' WHERE id = ?`,
      [slideId]
    );
  }
}

async function generateTileFromLevel(levelImagePath, levelDir, col, row, tileSize, levelWidth, levelHeight) {
  const outputPath = path.join(levelDir, `${col}_${row}.jpg`);

  const extractLeft = col * tileSize;
  const extractTop = row * tileSize;

  // Skip if completely out of bounds
  if (extractLeft >= levelWidth || extractTop >= levelHeight) {
    return;
  }

  // Calculate actual extraction size (handle edge tiles)
  const extractWidth = Math.min(tileSize, levelWidth - extractLeft);
  const extractHeight = Math.min(tileSize, levelHeight - extractTop);

  try {
    // If this is a full tile, just extract it
    // If it's a partial tile (at the edge), extract and pad it
    if (extractWidth === tileSize && extractHeight === tileSize) {
      await sharp(levelImagePath)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractWidth,
          height: extractHeight
        })
        .jpeg({ quality: 80 })
        .toFile(outputPath);
    } else {
      // For edge tiles that are smaller than tileSize, create a padded tile
      const tile = await sharp(levelImagePath)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractWidth,
          height: extractHeight
        })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Create a full-size tile with the extracted image embedded
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
          raw: {
            width: tile.info.width,
            height: tile.info.height,
            channels: 3
          },
          left: 0,
          top: 0
        }])
        .jpeg({ quality: 80 })
        .toFile(outputPath);
    }
  } catch (e) {
    console.error(`Error generating tile ${col}_${row}:`, e.message);
    // Create blank tile if extraction fails
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

module.exports = {
  SUPPORTED_FORMATS,
  readKFBIOHeader,
  processSlide
};
