const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * KFBIO Processor - Extracts tiles and builds pyramid for WSI viewing
 * KFBIO files contain:
 * - Header with dimensions
 * - Preview images (label + thumbnail)
 * - Many small tiles (typically 256x256 JPEGs)
 */

class KFBIOProcessor {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = null;
    this.header = {};
    this.tiles = []; // Array of {offset, length, x, y, level}
  }

  async open() {
    this.fd = fs.openSync(this.filePath, 'r');
    const stats = fs.statSync(this.filePath);
    this.fileSize = stats.size;
  }

  close() {
    if (this.fd) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  /**
   * Parse KFBIO header to extract dimensions and structure
   */
  parseHeader() {
    const headerBuf = Buffer.alloc(4096);
    fs.readSync(this.fd, headerBuf, 0, 4096, 0);

    // Read potential dimensions from header
    // Based on analysis: offset 0x10 and 0x14 contain large values
    const width = headerBuf.readUInt32LE(0x10);
    const height = headerBuf.readUInt32LE(0x14);

    // Validate dimensions
    if (width > 1000 && width < 100000 && height > 1000 && height < 100000) {
      this.header.width = width;
      this.header.height = height;
    }

    // Read other potential metadata
    const tileCount1 = headerBuf.readUInt32LE(0x28); // 11000
    const tileCount2 = headerBuf.readUInt32LE(0x38); // 72696

    console.log('KFBIO Header parsed:');
    console.log('  Dimensions:', this.header.width, 'x', this.header.height);
    console.log('  Tile counts:', tileCount1, tileCount2);

    return this.header;
  }

  /**
   * Scan file to find all tile locations and their grid positions
   */
  async scanTiles() {
    console.log('Scanning for tiles in KFBIO file...');

    const tiles = [];
    const processedOffsets = new Set();

    // Skip the first ~150KB (header + preview images)
    const scanStart = 150000;
    const chunkSize = 2 * 1024 * 1024; // 2MB chunks

    for (let offset = scanStart; offset < this.fileSize; offset += chunkSize) {
      const readLength = Math.min(chunkSize + 1024, this.fileSize - offset);
      const buffer = Buffer.alloc(readLength);
      fs.readSync(this.fd, buffer, 0, readLength, offset);

      // Find all JPEG SOI markers in this chunk
      for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i+1] === 0xD8) {
          const soiOffset = offset + i;

          // Skip duplicates (within 1KB)
          if (processedOffsets.has(Math.floor(soiOffset / 1024))) {
            continue;
          }

          // Read tile header to get dimensions
          const tileHeader = Buffer.alloc(512);
          fs.readSync(this.fd, tileHeader, 0, 512, soiOffset);

          // Find SOF0 marker for dimensions
          let tileWidth = 0, tileHeight = 0;
          for (let j = 0; j < tileHeader.length - 10; j++) {
            if (tileHeader[j] === 0xFF && (tileHeader[j+1] === 0xC0 || tileHeader[j+1] === 0xC2)) {
              tileHeight = tileHeader.readUInt16BE(j+5);
              tileWidth = tileHeader.readUInt16BE(j+7);
              break;
            }
          }

          // Only process 256x256 tiles (skip other sizes)
          if (tileWidth === 256 && tileHeight === 256) {
            // Find EOI marker
            let eoiOffset = await this.findEOI(soiOffset);

            if (eoiOffset > soiOffset) {
              tiles.push({
                offset: soiOffset,
                length: eoiOffset - soiOffset,
                width: tileWidth,
                height: tileHeight
              });
              processedOffsets.add(Math.floor(soiOffset / 1024));

              if (tiles.length % 1000 === 0) {
                console.log(`  Found ${tiles.length} tiles...`);
              }
            }
          }
        }
      }
    }

    console.log(`Total 256x256 tiles found: ${tiles.length}`);
    this.tiles = tiles;
    return tiles;
  }

  /**
   * Find JPEG EOI marker (0xFFD9)
   */
  async findEOI(startOffset) {
    const maxSearch = Math.min(this.fileSize - startOffset, 100 * 1024); // Max 100KB per tile
    const chunkSize = 8192;

    for (let offset = 2; offset < maxSearch; offset += chunkSize) {
      const readLen = Math.min(chunkSize + 2, maxSearch - offset);
      const buf = Buffer.alloc(readLen);
      fs.readSync(this.fd, buf, 0, readLen, startOffset + offset);

      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i+1] === 0xD9) {
          return startOffset + offset + i + 2;
        }
      }
    }

    return -1;
  }

  /**
   * Arrange tiles into a grid based on their file order
   * KFBIO tiles are typically stored in row-major order
   */
  arrangeTilesInGrid() {
    if (this.tiles.length === 0) return null;

    // Sort tiles by offset (file order)
    this.tiles.sort((a, b) => a.offset - b.offset);

    // Calculate grid dimensions
    // Assuming tiles are in row-major order
    const numTiles = this.tiles.length;
    const cols = Math.ceil(Math.sqrt(numTiles * (this.header.width / this.header.height)));
    const rows = Math.ceil(numTiles / cols);

    console.log(`Arranging ${numTiles} tiles in ${cols}x${rows} grid`);

    // Assign grid positions
    this.tiles.forEach((tile, index) => {
      tile.gridX = index % cols;
      tile.gridY = Math.floor(index / cols);
    });

    return { cols, rows, tileCount: numTiles };
  }

  /**
   * Build a viewable pyramid from KFBIO tiles
   * Strategy: Create a lower-resolution overview image from tiles
   */
  async buildOverviewImage(outputPath, maxDimension = 4096) {
    if (this.tiles.length === 0) {
      throw new Error('No tiles found to build overview');
    }

    const grid = this.arrangeTilesInGrid();
    console.log('Building overview image...');

    // Calculate output dimensions
    const fullWidth = grid.cols * 256;
    const fullHeight = grid.rows * 256;

    // Scale down if too large
    const scale = Math.min(1, maxDimension / Math.max(fullWidth, fullHeight));
    const outputWidth = Math.floor(fullWidth * scale);
    const outputHeight = Math.floor(fullHeight * scale);

    console.log(`Creating ${outputWidth}x${outputHeight} overview from ${fullWidth}x${fullHeight}`);

    // Create a composite image
    // Due to memory constraints, we'll process in strips
    const stripHeight = 4; // tiles per strip
    const strips = Math.ceil(grid.rows / stripHeight);

    // Create base image with sharp
    const composite = sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 3,
        background: { r: 240, g: 240, b: 240 }
      }
    });

    const overlays = [];

    for (let strip = 0; strip < strips; strip++) {
      const startRow = strip * stripHeight;
      const endRow = Math.min(startRow + stripHeight, grid.rows);

      console.log(`Processing strip ${strip + 1}/${strips} (rows ${startRow}-${endRow})...`);

      for (let row = startRow; row < endRow; row++) {
        for (let col = 0; col < grid.cols; col++) {
          const tileIndex = row * grid.cols + col;
          if (tileIndex >= this.tiles.length) continue;

          const tile = this.tiles[tileIndex];

          // Extract tile to temp buffer
          const tileBuffer = Buffer.alloc(tile.length);
          fs.readSync(this.fd, tileBuffer, 0, tile.length, tile.offset);

          // Add to overlays
          overlays.push({
            input: tileBuffer,
            left: Math.floor(col * 256 * scale),
            top: Math.floor(row * 256 * scale)
          });
        }
      }
    }

    // Compose final image
    await composite
      .composite(overlays)
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    console.log(`Overview image saved to ${outputPath}`);
    return {
      width: outputWidth,
      height: outputHeight,
      tileCount: this.tiles.length
    };
  }

  /**
   * Alternative: Build pyramid tiles from KFBIO for deep zoom
   * This creates a standard tile pyramid that OpenSeadragon can use
   */
  async buildTilePyramid(outputDir, tileSize = 256) {
    if (this.tiles.length === 0) {
      throw new Error('No tiles found');
    }

    const grid = this.arrangeTilesInGrid();
    const fullWidth = grid.cols * 256;
    const fullHeight = grid.rows * 256;

    console.log(`Building tile pyramid: ${fullWidth}x${fullHeight}`);
    console.log(`Grid: ${grid.cols}x${grid.rows}, Tiles: ${grid.tileCount}`);

    // Calculate pyramid levels
    const maxLevel = Math.ceil(Math.log2(Math.max(fullWidth, fullHeight) / tileSize));
    console.log(`Pyramid levels: 0-${maxLevel}`);

    // For now, create a single high-res overview
    // Full pyramid construction would require significant processing
    const overviewPath = path.join(outputDir, 'overview.jpg');
    const overviewInfo = await this.buildOverviewImage(overviewPath, 8192);

    return {
      width: fullWidth,
      height: fullHeight,
      overviewWidth: overviewInfo.width,
      overviewHeight: overviewInfo.height,
      maxLevel,
      tileCount: grid.tileCount
    };
  }
}

/**
 * Main entry point: Process KFBIO file for viewing
 */
async function processKFBIO(filePath, outputDir) {
  const processor = new KFBIOProcessor(filePath);

  try {
    await processor.open();

    // Parse header
    const header = processor.parseHeader();

    // Scan for tiles
    const tiles = await processor.scanTiles();

    if (tiles.length === 0) {
      throw new Error('No tiles found in KFBIO file');
    }

    // Build pyramid
    const pyramidInfo = await processor.buildTilePyramid(outputDir);

    return {
      success: true,
      header,
      ...pyramidInfo
    };

  } finally {
    processor.close();
  }
}

module.exports = {
  KFBIOProcessor,
  processKFBIO
};
