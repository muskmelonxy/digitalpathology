const fs = require('fs');
const path = require('path');

/**
 * KFBIO File Parser
 * KFBIO files are digital pathology slide formats from KFBIO scanners.
 * They contain a proprietary header with embedded JPEG/JPEG2000 image data.
 */

// KFBIO magic numbers and markers
const KFBIO_MAGIC = Buffer.from([0x4B, 0x46, 0x42]); // "KFB"
const JPEG_SOI = Buffer.from([0xFF, 0xD8]); // JPEG Start of Image
const JPEG_EOI = Buffer.from([0xFF, 0xD9]); // JPEG End of Image

class KFBIOParser {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = null;
    this.header = {};
    this.thumbnailOffset = 0;
    this.thumbnailLength = 0;
    this.imageOffset = 0;
    this.imageLength = 0;
  }

  async open() {
    return new Promise((resolve, reject) => {
      fs.open(this.filePath, 'r', (err, fd) => {
        if (err) {
          reject(err);
          return;
        }
        this.fd = fd;
        resolve();
      });
    });
  }

  async close() {
    if (this.fd) {
      return new Promise((resolve) => {
        fs.close(this.fd, () => resolve());
        this.fd = null;
      });
    }
  }

  async readBuffer(offset, length) {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.alloc(length);
      fs.read(this.fd, buffer, 0, length, offset, (err, bytesRead, buf) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(buf);
      });
    });
  }

  /**
   * Parse KFBIO file header
   * KFBIO files typically have:
   * - Header section with metadata
   * - Thumbnail image (JPEG)
   * - Full resolution image data
   */
  async parseHeader() {
    try {
      // Read first 4KB to analyze header
      const headerBuf = await this.readBuffer(0, 4096);

      // Check for KFBIO signature (may be at offset 0 or within first few bytes)
      const isKFBIO = this.checkKFBIOSignature(headerBuf);
      if (!isKFBIO) {
        console.log('File does not have standard KFBIO signature, trying alternative parsing...');
      }

      // Try to find JPEG markers in the file
      const jpegInfo = this.findJPEGMarkers(headerBuf);

      // Look for dimension information in the header
      // KFBIO files often store dimensions at specific offsets
      const dimensions = this.extractDimensions(headerBuf);

      // Search for thumbnail JPEG
      const thumbnailInfo = await this.findThumbnail();

      // Search for full image data
      const imageInfo = await this.findFullImage();

      this.header = {
        isKFBIO,
        width: dimensions.width || 0,
        height: dimensions.height || 0,
        thumbnailOffset: thumbnailInfo.offset,
        thumbnailLength: thumbnailInfo.length,
        imageOffset: imageInfo.offset,
        imageLength: imageInfo.length,
        hasValidImage: thumbnailInfo.length > 0 || imageInfo.length > 0
      };

      return this.header;
    } catch (error) {
      console.error('Error parsing KFBIO header:', error);
      throw error;
    }
  }

  checkKFBIOSignature(buffer) {
    // Look for "KFB" signature
    for (let i = 0; i < Math.min(buffer.length - 3, 512); i++) {
      if (buffer[i] === 0x4B && buffer[i+1] === 0x46 && buffer[i+2] === 0x42) {
        return true;
      }
    }
    return false;
  }

  findJPEGMarkers(buffer) {
    const markers = [];
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i+1] === 0xD8) {
        markers.push({ type: 'SOI', offset: i });
      }
      if (buffer[i] === 0xFF && buffer[i+1] === 0xD9) {
        markers.push({ type: 'EOI', offset: i });
      }
    }
    return markers;
  }

  extractDimensions(buffer) {
    let width = 0;
    let height = 0;

    // Try common patterns for dimension storage
    // Pattern 1: Look for width/height at specific offsets (common in KFBIO)
    if (buffer.length > 64) {
      // Try reading dimensions from various offsets
      const candidates = [
        { wOffset: 16, hOffset: 20 },
        { wOffset: 24, hOffset: 28 },
        { wOffset: 32, hOffset: 36 },
        { wOffset: 40, hOffset: 44 }
      ];

      for (const cand of candidates) {
        const w = buffer.readUInt32LE(cand.wOffset);
        const h = buffer.readUInt32LE(cand.hOffset);
        // Validate: dimensions should be reasonable (100 - 200000)
        if (w > 100 && w < 200000 && h > 100 && h < 200000) {
          width = w;
          height = h;
          console.log(`Found dimensions at offset ${cand.wOffset}: ${w}x${h}`);
          break;
        }
      }
    }

    // Pattern 2: Search for common dimension pairs in the buffer
    if (width === 0) {
      for (let i = 0; i < buffer.length - 8; i += 4) {
        const w = buffer.readUInt32LE(i);
        const h = buffer.readUInt32LE(i + 4);
        if (w > 1000 && w < 100000 && h > 1000 && h < 100000 && Math.abs(w/h - 4/3) < 2) {
          width = w;
          height = h;
          console.log(`Found dimensions by pattern search at offset ${i}: ${w}x${h}`);
          break;
        }
      }
    }

    return { width, height };
  }

  async findThumbnail() {
    // Read larger portion to find thumbnail
    const chunkSize = 1024 * 1024; // 1MB
    const stats = fs.statSync(this.filePath);
    const searchSize = Math.min(chunkSize, stats.size);

    const buffer = await this.readBuffer(0, searchSize);

    // Find first JPEG SOI marker
    let soiOffset = -1;
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i+1] === 0xD8) {
        soiOffset = i;
        break;
      }
    }

    if (soiOffset === -1) {
      return { offset: 0, length: 0 };
    }

    // Find corresponding EOI marker
    let eoiOffset = -1;
    for (let i = soiOffset + 2; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i+1] === 0xD9) {
        eoiOffset = i + 2;
        break;
      }
    }

    if (eoiOffset === -1) {
      // If no EOI found, assume thumbnail extends to reasonable size
      eoiOffset = Math.min(soiOffset + 50000, buffer.length);
    }

    return {
      offset: soiOffset,
      length: eoiOffset - soiOffset
    };
  }

  async findFullImage() {
    const stats = fs.statSync(this.filePath);

    // For KFBIO files, full image might be at a specific offset or after thumbnail
    // Try to find large JPEG data
    const searchStart = 1024; // Skip header
    const chunkSize = 2 * 1024 * 1024; // 2MB chunks
    const searchEnd = Math.min(stats.size, 10 * 1024 * 1024); // Search first 10MB

    for (let offset = searchStart; offset < searchEnd; offset += chunkSize) {
      const readLength = Math.min(chunkSize, searchEnd - offset);
      const buffer = await this.readBuffer(offset, readLength);

      // Look for JPEG SOI marker
      for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i+1] === 0xD8) {
          const absoluteOffset = offset + i;
          // Skip if this is likely the thumbnail (within first 100KB)
          if (absoluteOffset > 100000) {
            // Estimate image size (read until EOF or next header)
            const estimatedLength = stats.size - absoluteOffset;
            return { offset: absoluteOffset, length: estimatedLength };
          }
        }
      }
    }

    return { offset: 0, length: 0 };
  }

  /**
   * Extract thumbnail as JPEG buffer
   */
  async extractThumbnail() {
    if (this.header.thumbnailOffset && this.header.thumbnailLength) {
      return await this.readBuffer(this.header.thumbnailOffset, this.header.thumbnailLength);
    }
    return null;
  }

  /**
   * Extract full image data
   */
  async extractImage(outputPath) {
    const stats = fs.statSync(this.filePath);

    // If we found JPEG data in the file, extract it
    if (this.header.imageOffset && this.header.imageLength) {
      const chunkSize = 1024 * 1024; // 1MB chunks
      const writeStream = fs.createWriteStream(outputPath);

      return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);

        let currentOffset = this.header.imageOffset;
        const endOffset = Math.min(this.header.imageOffset + this.header.imageLength, stats.size);

        const readChunk = async () => {
          try {
            if (currentOffset >= endOffset) {
              writeStream.end();
              return;
            }

            const readLength = Math.min(chunkSize, endOffset - currentOffset);
            const buffer = await this.readBuffer(currentOffset, readLength);
            writeStream.write(buffer);
            currentOffset += readLength;

            // Continue reading
            setImmediate(readChunk);
          } catch (err) {
            writeStream.destroy(err);
          }
        };

        readChunk();
      });
    }

    throw new Error('No valid image data found in KFBIO file');
  }
}

/**
 * Alternative approach: Try to convert KFBIO using external tools
 * or extract embedded JPEG by scanning the entire file
 */
async function extractKFBIOImage(filePath, outputPath) {
  const parser = new KFBIOParser(filePath);

  try {
    await parser.open();
    const header = await parser.parseHeader();

    console.log('KFBIO Header:', header);

    if (!header.hasValidImage) {
      throw new Error('No valid image data found in KFBIO file');
    }

    // If we have a valid full image, extract it
    if (header.imageOffset && header.imageLength > 0) {
      await parser.extractImage(outputPath);
      console.log(`Extracted image to ${outputPath}`);
      return {
        success: true,
        width: header.width,
        height: header.height,
        outputPath
      };
    }

    // Otherwise, try to extract thumbnail as fallback
    if (header.thumbnailOffset && header.thumbnailLength > 0) {
      const thumbnailData = await parser.extractThumbnail();
      if (thumbnailData) {
        fs.writeFileSync(outputPath, thumbnailData);
        console.log(`Extracted thumbnail to ${outputPath}`);
        return {
          success: true,
          width: header.width || 0,
          height: header.height || 0,
          isThumbnail: true,
          outputPath
        };
      }
    }

    throw new Error('Could not extract image data');
  } finally {
    await parser.close();
  }
}

/**
 * Extract JPEG from KFBIO with smart filtering
 * KFBIO files contain both label image and slide image
 * We need to extract the slide image, not the label
 */
async function extractJPEGFromKFBIO(filePath, outputPath) {
  const stats = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');

  try {
    const chunkSize = 2 * 1024 * 1024; // 2MB chunks for faster scanning
    const foundJpegs = [];

    console.log(`Scanning KFBIO file (${(stats.size / 1024 / 1024).toFixed(2)} MB) for JPEG images...`);

    // First pass: find all JPEG markers in the file
    for (let offset = 0; offset < stats.size; offset += chunkSize) {
      const readLength = Math.min(chunkSize + 1024, stats.size - offset);
      const buffer = Buffer.alloc(readLength);
      fs.readSync(fd, buffer, 0, readLength, offset);

      // Find JPEG SOI markers (0xFFD8)
      for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i+1] === 0xD8) {
          const soiOffset = offset + i;

          // Quick check: skip if this is very close to another found JPEG (within 1KB)
          // This avoids duplicate detections from overlapping chunks
          const isDuplicate = foundJpegs.some(j => Math.abs(j.offset - soiOffset) < 1024);
          if (isDuplicate) continue;

          // Estimate JPEG size by searching for EOI marker
          // Search up to 200MB ahead for the EOI marker
          const maxSearch = Math.min(stats.size - soiOffset, 200 * 1024 * 1024);
          let eoiOffset = -1;

          // Read in chunks to find EOI
          const searchChunkSize = 1024 * 1024; // 1MB
          for (let searchOffset = 2; searchOffset < maxSearch; searchOffset += searchChunkSize) {
            const searchLen = Math.min(searchChunkSize + 1024, maxSearch - searchOffset);
            const searchBuf = Buffer.alloc(searchLen);
            fs.readSync(fd, searchBuf, 0, searchLen, soiOffset + searchOffset);

            for (let j = 0; j < searchBuf.length - 1; j++) {
              if (searchBuf[j] === 0xFF && searchBuf[j+1] === 0xD9) {
                eoiOffset = soiOffset + searchOffset + j + 2;
                break;
              }
            }

            if (eoiOffset > 0) break;
          }

          if (eoiOffset > soiOffset) {
            const jpegLength = eoiOffset - soiOffset;

            // Read JPEG header to get dimensions
            const headerBuf = Buffer.alloc(500);
            fs.readSync(fd, headerBuf, 0, 500, soiOffset);

            // Find SOF0 marker (0xFFC0) for dimensions
            let width = 0, height = 0;
            for (let k = 0; k < headerBuf.length - 10; k++) {
              if (headerBuf[k] === 0xFF && (headerBuf[k+1] === 0xC0 || headerBuf[k+1] === 0xC2)) {
                height = headerBuf.readUInt16BE(k+5);
                width = headerBuf.readUInt16BE(k+7);
                break;
              }
            }

            const ratio = width > 0 && height > 0 ? width / height : 0;

            foundJpegs.push({
              offset: soiOffset,
              length: jpegLength,
              position: soiOffset / stats.size, // Relative position in file (0-1)
              width,
              height,
              ratio
            });

            if (width > 0) {
              console.log(`  Found JPEG at offset ${soiOffset}: ${(jpegLength / 1024).toFixed(1)} KB, ${width}x${height}, ratio=${ratio.toFixed(2)}`);
            } else {
              console.log(`  Found JPEG at offset ${soiOffset}: ${(jpegLength / 1024).toFixed(1)} KB, dimensions unknown`);
            }
          }
        }
      }
    }

    console.log(`Total JPEG images found: ${foundJpegs.length}`);

    if (foundJpegs.length === 0) {
      throw new Error('No JPEG data found in KFBIO file');
    }

    // Strategy to select the correct image (slide, not label):
    // Based on analysis of KFBIO files:
    // - 880x736 (ratio 1.20, ~75KB) at offset 72748 is the LABEL
    // - 1548x804 (ratio 1.93, ~70KB) at offset 271 is the SLIDE PREVIEW
    // The wider one (ratio > 1.5) is the actual slide!

    // First, filter to significant images (> 50KB to exclude tiles)
    const significantImages = foundJpegs.filter(j => j.length > 50 * 1024);
    console.log(`Found ${significantImages.length} significant images (>50KB)`);

    // Among significant images, find those with wide ratio (slides)
    const slideCandidates = significantImages.filter(j => j.ratio > 1.5);
    const labelCandidates = significantImages.filter(j => j.ratio <= 1.5);

    console.log(`  Slide candidates (ratio > 1.5): ${slideCandidates.length}`);
    console.log(`  Label candidates (ratio <= 1.5): ${labelCandidates.length}`);

    slideCandidates.forEach((j, i) => {
      console.log(`    Slide ${i+1}: ${j.width}x${j.height}, ratio=${j.ratio.toFixed(2)}, size=${(j.length/1024).toFixed(1)}KB`);
    });
    labelCandidates.forEach((j, i) => {
      console.log(`    Label ${i+1}: ${j.width}x${j.height}, ratio=${j.ratio.toFixed(2)}, size=${(j.length/1024).toFixed(1)}KB`);
    });

    let selectedJpeg;

    if (slideCandidates.length > 0) {
      // Use the slide with the widest ratio (most likely the actual slide)
      slideCandidates.sort((a, b) => b.ratio - a.ratio);
      selectedJpeg = slideCandidates[0];
      console.log(`\nSelected SLIDE image: ${selectedJpeg.width}x${selectedJpeg.height} (ratio ${selectedJpeg.ratio.toFixed(2)})`);
    } else if (significantImages.length > 0) {
      // No slide candidate found, use the largest significant image
      significantImages.sort((a, b) => b.length - a.length);
      selectedJpeg = significantImages[0];
      console.log(`\nNo slide candidate found, using largest: ${selectedJpeg.width}x${selectedJpeg.height}`);
    } else {
      // Fallback to largest overall
      selectedJpeg = foundJpegs[0];
      console.log(`\nFallback to largest overall: ${selectedJpeg.width}x${selectedJpeg.height}`);
    }

    console.log(`Selected JPEG: offset=${selectedJpeg.offset}, size=${(selectedJpeg.length / 1024).toFixed(1)} KB, position=${(selectedJpeg.position * 100).toFixed(1)}%`);

    // Extract the selected JPEG
    const writeStream = fs.createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        console.log(`Successfully extracted JPEG to ${outputPath}`);
        resolve({
          success: true,
          offset: selectedJpeg.offset,
          length: selectedJpeg.length,
          totalImages: foundJpegs.length
        });
      });
      writeStream.on('error', reject);

      let currentOffset = selectedJpeg.offset;
      const endOffset = selectedJpeg.offset + selectedJpeg.length;

      const readChunk = () => {
        const readLen = Math.min(chunkSize, endOffset - currentOffset);
        const buf = Buffer.alloc(readLen);
        fs.read(fd, buf, 0, readLen, currentOffset, (err, bytesRead, b) => {
          if (err) {
            writeStream.destroy(err);
            return;
          }
          writeStream.write(b);
          currentOffset += bytesRead;

          if (currentOffset >= endOffset) {
            writeStream.end();
          } else {
            setImmediate(readChunk);
          }
        });
      };

      readChunk();
    });

  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  KFBIOParser,
  extractKFBIOImage,
  extractJPEGFromKFBIO
};
