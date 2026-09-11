#!/usr/bin/env node
/**
 * End-to-end: synthetic JPEG → preview-only processSlide (no full pyramid)
 * then on-demand ensureTile for a missing high-res JPEG.
 */
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { initDatabase, run, get } = require('../server/database');
const { processSlide } = require('../server/utils/slideProcessor');
const { expectedGrid } = require('../server/utils/pyramid');
const { ensureTile } = require('../server/utils/tileServe');

(async () => {
  await initDatabase();
  const src = path.join(__dirname, '../uploads/slides/_test_pipeline.jpg');
  await fs.ensureDir(path.dirname(src));
  await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 20, g: 140, b: 90 } }
  }).jpeg({ quality: 90 }).toFile(src);

  const ins = await run(
    `INSERT INTO slides (name, description, filename, original_format, course_id, uploaded_by, tile_size, status)
     VALUES ('pipeline-test', '', '_test_pipeline.jpg', 'jpg', NULL, 1, 256, 'processing')`
  );
  const id = ins.id;
  const t0 = Date.now();
  await processSlide(id, src, 'jpg', 256);
  const ms = Date.now() - t0;
  const row = await get('SELECT * FROM slides WHERE id = ?', [id]);
  if (!row || row.status !== 'ready') {
    throw new Error(`expected ready, got ${row && row.status} ${row && row.error_message}`);
  }
  if (Number(row.pyramid_complete) !== 1) {
    throw new Error(`pyramid_complete=${row.pyramid_complete}`);
  }
  const tilesDir = path.join(__dirname, '../uploads/tiles', String(id));
  const origin = path.join(tilesDir, '0', '0_0.jpg');
  if (!fs.existsSync(origin)) throw new Error(`missing coarse tile ${origin}`);
  const metaPath = path.join(tilesDir, 'pyramid.json');
  if (!fs.existsSync(metaPath)) throw new Error('pyramid.json missing');
  const overview = path.join(__dirname, '../uploads/overviews', `${id}.jpg`);
  if (!fs.existsSync(overview)) throw new Error('overview missing');

  const maxLv = row.max_level;
  if (maxLv > 0) {
    const hi = path.join(tilesDir, String(maxLv), '0_0.jpg');
    if (fs.existsSync(hi)) {
      throw new Error(`high-res tile should not be prebuilt: ${hi}`);
    }
    const t1 = Date.now();
    await ensureTile(id, maxLv, 0, 0);
    const genMs = Date.now() - t1;
    if (!fs.existsSync(hi)) throw new Error('ensureTile did not write high-res tile');
    const info = await sharp(hi).metadata();
    if (info.format !== 'jpeg') throw new Error(`generated tile format ${info.format}`);
    console.log(`ondemand maxLevel tile in ${genMs}ms`);
  }

  const { cols, rows } = expectedGrid(row.width, row.height, row.tile_size, 0, row.max_level);
  const l0 = fs.readdirSync(path.join(tilesDir, '0')).filter(f => f.endsWith('.jpg'));
  if (!l0.includes('0_0.jpg')) throw new Error('level 0 missing 0_0.jpg');

  const express = require('express');
  const http = require('http');
  const { tileMiddleware } = require('../server/utils/tileServe');
  const app = express();
  app.use('/tiles', tileMiddleware);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const fetchTile = (url) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: url }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'],
        cache: res.headers['cache-control'],
        body: Buffer.concat(chunks)
      }));
    }).on('error', reject);
  });
  const cached = await fetchTile(`/tiles/${id}/0/0_0.jpg`);
  if (cached.status !== 200 || !/jpeg/i.test(cached.type || '')) {
    throw new Error(`level0 tile HTTP ${cached.status} ${cached.type}`);
  }
  if (!/max-age=604800/.test(cached.cache || '')) {
    throw new Error(`expected 7d cache, got ${cached.cache}`);
  }
  if (maxLv > 0) {
    const { cols: hc } = expectedGrid(row.width, row.height, row.tile_size, maxLv, maxLv);
    const missCol = Math.min(1, hc - 1);
    const generated = await fetchTile(`/tiles/${id}/${maxLv}/${missCol}_0.jpg`);
    if (generated.status !== 200 || generated.body.length < 200) {
      throw new Error(`ondemand HTTP ${generated.status} bytes=${generated.body.length}`);
    }
  }
  const missing = await fetchTile(`/tiles/${id}/0/99_99.jpg`);
  if (missing.status !== 404) throw new Error(`expected 404 for OOB tile, got ${missing.status}`);
  server.close();

  console.log(JSON.stringify({
    id, ms, status: row.status, dim: `${row.width}x${row.height}`,
    maxLevel: row.max_level, pyramid_complete: row.pyramid_complete,
    progress: row.processing_progress, message: row.processing_message,
    level0: `${cols}x${rows}`
  }));
  console.log('PROCESS SLIDE CHECK PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
