#!/usr/bin/env node
/**
 * On-demand tile: synthetic JPEG is NOT fully pyramided; a missing high-res
 * tile is generated on first ensureTile() call.
 */
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const sharp = require('sharp');
const { generateOneTile, calcMaxLevel, expectedGrid, writePyramidMeta } = require('../server/utils/pyramid');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ondemand-'));
  const src = path.join(dir, 'src.jpg');
  const tiles = path.join(dir, 'tiles');
  const W = 1600, H = 1200, TILE = 256;
  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 30, g: 90, b: 180 } }
  }).jpeg({ quality: 90 }).toFile(src);

  const maxLevel = calcMaxLevel(W, H, TILE);
  await writePyramidMeta(tiles, {
    width: W, height: H, tileSize: TILE, maxLevel, tile_mode: 'ondemand', source: 'sharp'
  });

  const lv = maxLevel;
  const { cols, rows } = expectedGrid(W, H, TILE, lv, maxLevel);
  const dest = path.join(tiles, String(lv), '0_0.jpg');
  if (await fs.pathExists(dest)) throw new Error('tile should not exist yet');

  const t0 = Date.now();
  const ok = await generateOneTile(src, dest, {
    level: lv, col: 0, row: 0, tileSize: TILE, maxLevel,
    sourceWidth: W, sourceHeight: H
  });
  const ms = Date.now() - t0;
  if (!ok && !await fs.pathExists(dest)) throw new Error('generateOneTile failed');
  const info = await sharp(dest).metadata();
  if (info.width !== TILE || info.height !== TILE) {
    throw new Error(`tile size ${info.width}x${info.height}`);
  }
  if (info.format !== 'jpeg') throw new Error(`format ${info.format}`);
  console.log(JSON.stringify({
    maxLevel, grid: `${cols}x${rows}`, ms, bytes: (await fs.stat(dest)).size
  }));
  await fs.remove(dir);
  console.log('ON-DEMAND TILE CHECK PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
