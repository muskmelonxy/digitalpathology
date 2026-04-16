const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const router = express.Router();
const { run, get } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { extractKFBIOImage, extractJPEGFromKFBIO } = require('../utils/kfbioParser');

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

// Supported formats
const SUPPORTED_FORMATS = ['.tiff', '.tif', '.jpg', '.jpeg', '.png', '.kfb', '.kfbio'];

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/slides'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (SUPPORTED_FORMATS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit for large slide files
  }
});

// Upload slide
router.post('/', authenticateToken, requireRole('teacher', 'admin'), upload.single('slide'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description, course_id, tile_size = 256 } = req.body;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const originalFormat = fileExt.replace('.', '');

    // Create database entry
    const result = await run(
      `INSERT INTO slides (name, description, filename, original_format, course_id, uploaded_by, tile_size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name || req.file.originalname,
        description || '',
        req.file.filename,
        originalFormat,
        course_id || null,
        req.user.id,
        parseInt(tile_size) || 256,
        'processing'
      ]
    );

    const slideId = result.id;

    // Start processing in background
    processSlide(slideId, req.file.path, originalFormat, tile_size);

    res.status(201).json({
      id: slideId,
      message: 'Upload successful, processing started',
      status: 'processing'
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      fs.removeSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Get upload status
router.get('/status/:id', authenticateToken, async (req, res) => {
  try {
    const slide = await get('SELECT id, status, name FROM slides WHERE id = ?', [req.params.id]);
    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }
    res.json(slide);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process slide into tiles
async function processSlide(slideId, filePath, format, tileSize) {
  const uploadsDir = path.join(__dirname, '../../uploads');
  const tilesDir = path.join(uploadsDir, 'tiles', slideId.toString());
  const thumbnailDir = path.join(uploadsDir, 'thumbnails');

  try {
    await fs.ensureDir(tilesDir);

    let image;
    let metadata;

    // Handle different formats
    let processFilePath = filePath;
    let isKFBIOConverted = false;

    if (format === 'kfb' || format === 'kfbio') {
      console.log(`Processing KFBIO file: ${filePath}`);

      // Read KFBIO header to get original dimensions
      const kfbHeader = await readKFBIOHeader(filePath);
      console.log('KFBIO header dimensions:', kfbHeader.width, 'x', kfbHeader.height);

      // Create temporary directory for extracted files
      const tempDir = path.join(uploadsDir, 'temp');
      await fs.ensureDir(tempDir);
      const extractedPath = path.join(tempDir, `${slideId}_extracted.jpg`);

      try {
        // Try to extract JPEG image from KFBIO file
        console.log('Attempting to extract JPEG from KFBIO...');
        const extractResult = await extractJPEGFromKFBIO(filePath, extractedPath);

        if (extractResult.success) {
          console.log(`Successfully extracted JPEG from KFBIO: ${extractResult.length} bytes`);
          processFilePath = extractedPath;
          isKFBIOConverted = true;

          // Get metadata from extracted file
          image = sharp(processFilePath, { limitInputPixels: false });
          metadata = await image.metadata();
          console.log(`Extracted preview dimensions: ${metadata.width}x${metadata.height}`);

          // For KFBIO, use the header dimensions as the "virtual" full size
          // but note that we're only showing a preview
          if (kfbHeader.width > 0 && kfbHeader.height > 0) {
            metadata.originalWidth = kfbHeader.width;
            metadata.originalHeight = kfbHeader.height;
            metadata.isPreview = true;
          }
        } else {
          throw new Error('Failed to extract image from KFBIO');
        }
      } catch (kfbError) {
        console.error('KFBIO extraction failed:', kfbError.message);
        throw new Error(`Unable to process KFBIO file: ${kfbError.message}`);
      }
    } else {
      // Standard image formats
      image = sharp(filePath, { limitInputPixels: false });
      metadata = await image.metadata();
    }

    const width = metadata.width;
    const height = metadata.height;

    // Calculate pyramid levels
    const maxLevel = Math.ceil(Math.log2(Math.max(width, height) / tileSize));

    // Generate thumbnail
    const thumbnailPath = path.join(thumbnailDir, `${slideId}.jpg`);
    await sharp(processFilePath, { limitInputPixels: false })
      .resize(400, 400, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);

    // Generate pyramid tiles
    // OpenSeadragon expects:
    //   Level 0 = lowest resolution (overview, single tile)
    //   Level maxLevel = highest resolution (original image)
    for (let level = 0; level <= maxLevel; level++) {
      const levelDir = path.join(tilesDir, level.toString());
      await fs.ensureDir(levelDir);

      // At level 0: scale = 2^maxLevel (smallest image)
      // At level maxLevel: scale = 1 (original image)
      const scale = Math.pow(2, maxLevel - level);
      const levelWidth = Math.ceil(width / scale);
      const levelHeight = Math.ceil(height / scale);

      const cols = Math.ceil(levelWidth / tileSize);
      const rows = Math.ceil(levelHeight / tileSize);

      console.log(`Processing level ${level}: ${levelWidth}x${levelHeight}, ${cols}x${rows} tiles, scale=${scale}`);

      // Generate this level by resizing the original image once, then extract tiles
      const levelImagePath = path.join(tilesDir, `_level_${level}.jpg`);

      // Create resized version of image for this level
      await sharp(processFilePath, { limitInputPixels: false })
        .resize(levelWidth, levelHeight, {
          fit: 'fill',
          withoutEnlargement: false
        })
        .jpeg({ quality: 90 })
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

      // Clean up the temporary level image
      await fs.remove(levelImagePath);
    }

    // Clean up KFBIO extracted temp file if it was converted
    if (isKFBIOConverted && processFilePath !== filePath) {
      try {
        await fs.remove(processFilePath);
        console.log(`Cleaned up temp KFBIO file: ${processFilePath}`);
      } catch (cleanupErr) {
        console.error('Failed to cleanup temp KFBIO file:', cleanupErr.message);
      }
    }

    // Update database with success
    await run(
      `UPDATE slides SET status = 'ready', width = ?, height = ?, max_level = ?, thumbnail_path = ? WHERE id = ?`,
      [width, height, maxLevel, `/uploads/thumbnails/${slideId}.jpg`, slideId]
    );

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
        .jpeg({ quality: 90 })
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
        .jpeg({ quality: 90 })
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
      .jpeg()
      .toFile(outputPath);
  }
}

module.exports = router;
