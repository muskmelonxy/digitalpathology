#!/usr/bin/env node
/**
 * End-to-end: synthetic JPEG → processSlide → DB ready + on-disk tiles.
 */
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { initDatabase, run, get } = require('../server/database');
const { processSlide } = require('../server/utils/slideProcessor');
const { expectedGrid } = require('../server/utils/pyramid');

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
  for (let lv = 0; lv <= row.max_level; lv++) {
    const { cols, rows } = expectedGrid(row.width, row.height, row.tile_size, lv, row.max_level);
    const origin = path.join(tilesDir, String(lv), '0_0.jpg');
    if (!fs.existsSync(origin)) throw new Error(`missing ${origin}`);
    const files = fs.readdirSync(path.join(tilesDir, String(lv))).filter(f => f.endsWith('.jpg'));
    const maxC = Math.max(...files.map(f => +f.split('_')[0]));
    const maxR = Math.max(...files.map(f => +f.split('_')[1].replace('.jpg', '')));
    if (maxC + 1 !== cols || maxR + 1 !== rows) {
      throw new Error(`lv${lv} grid ${maxC + 1}x${maxR + 1} != ${cols}x${rows}`);
    }
  }
  const overview = path.join(__dirname, '../uploads/overviews', `${id}.jpg`);
  if (!fs.existsSync(overview)) throw new Error('overview missing');
  console.log(JSON.stringify({
    id, ms, status: row.status, dim: `${row.width}x${row.height}`,
    maxLevel: row.max_level, pyramid_complete: row.pyramid_complete,
    progress: row.processing_progress, message: row.processing_message
  }));
  console.log('PROCESS SLIDE CHECK PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
