#!/usr/bin/env node
/**
 * Generate a synthetic image, run Sharp google tiling + remap, assert
 * {level}/{col}_{row}.jpg matches OSD/server grid math.
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const { generatePyramid, calcMaxLevel, expectedGrid } = require('../server/utils/pyramid');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pyramid-'));
  const src = path.join(dir, 'src.jpg');
  const tiles = path.join(dir, 'tiles');
  const W = 2000, H = 1400, TILE = 256;

  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 180, g: 40, b: 40 } }
  }).jpeg({ quality: 90 }).toFile(src);

  const t0 = Date.now();
  const result = await generatePyramid(src, tiles, W, H, TILE);
  const ms = Date.now() - t0;
  console.log(`engine=${result.engine} nTiles=${result.nTiles} ${ms}ms`);

  const maxLevel = calcMaxLevel(W, H, TILE);
  if (result.maxLevel !== maxLevel) {
    throw new Error(`maxLevel ${result.maxLevel} != ${maxLevel}`);
  }

  for (let lv = 0; lv <= maxLevel; lv++) {
    const { cols, rows } = expectedGrid(W, H, TILE, lv, maxLevel);
    // Google/libvips layout is {z}/{row}/{col}.jpg; we store {col}_{row}.jpg.
    const files = (await fs.readdir(path.join(tiles, String(lv)))).filter(f => f.endsWith('.jpg'));
    const names = new Set(files);
    // Google layout can skip identical/blank tiles; require the origin tile and grid bounds.
    if (!names.has('0_0.jpg')) {
      throw new Error(`missing 0_0.jpg at level ${lv}`);
    }
    const maxC = Math.max(...files.map(f => +f.split('_')[0]));
    const maxR = Math.max(...files.map(f => +f.split('_')[1].replace('.jpg', '')));
    if (maxC + 1 !== cols || maxR + 1 !== rows) {
      throw new Error(`level ${lv}: expected grid ${cols}x${rows}, got max ${maxC + 1}x${maxR + 1} (${files.length} files)`);
    }
    console.log(`  level ${lv}: ${cols}x${rows} (${files.length} files)`);
  }

  await fs.remove(dir);
  console.log('SHARP TILE LAYOUT CHECK PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
