// verify-tile-mapping.js — validate the new OSD↔server level mapping against
// the actual pyramid directories on disk, for every slide.
const fs = require('fs');
const path = require('path');
const { query } = require('./server/database');

function actualTiles(slideId) {
  const dir = path.join('uploads', 'tiles', String(slideId));
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const lv of fs.readdirSync(dir)) {
    if (!/^\d+$/.test(lv)) continue;
    const files = fs.readdirSync(path.join(dir, lv)).filter(f => f.endsWith('.jpg'));
    let maxX = -1, maxY = -1;
    for (const f of files) {
      const m = f.match(/^(\d+)_(\d+)\.jpg$/);
      if (m) { maxX = Math.max(maxX, +m[1]); maxY = Math.max(maxY, +m[2]); }
    }
    out[+lv] = { cols: maxX + 1, rows: maxY + 1, files: files.length };
  }
  return out;
}

// The new OSD tile source logic (as implemented in SlideViewer.js)
function expectedForOSDLevel(level, slide) {
  const maxLevel = slide.max_level;
  const serverLevel = maxLevel - level;
  const scale = Math.pow(2, level);
  return {
    level,
    serverLevel,
    x: Math.max(1, Math.ceil(slide.width / scale / slide.tile_size)),
    y: Math.max(1, Math.ceil(slide.height / scale / slide.tile_size))
  };
}

(async () => {
  const slides = await query('SELECT id, name, width, height, tile_size, max_level, status FROM slides ORDER BY id');
  let allOk = true;

  for (const s of slides) {
    const actual = actualTiles(s.id);
    const levels = Object.keys(actual).map(Number).sort((a, b) => a - b);
    if (levels.length === 0) { console.log(`slide #${s.id} ${s.name}: NO TILES`); allOk = false; continue; }

    const serverMaxLevel = Math.max(...levels);
    const checks = [];
    for (const lv of levels) {
      // lv = server level. The OSD level that maps to it is maxLevel - lv.
      const osdLevel = serverMaxLevel - lv;
      const exp = expectedForOSDLevel(osdLevel, { ...s, max_level: serverMaxLevel });
      const act = actual[lv];
      const ok = act.cols === exp.x && act.rows === exp.y;
      if (!ok) allOk = false;
      checks.push(`server lv${lv} ← OSD lv${osdLevel}: expected ${exp.x}x${exp.y}, actual ${act.cols}x${act.rows} ${ok ? '✓' : '✗ MISMATCH'}`);
    }
    console.log(`\nslide #${s.id} ${s.name} (${s.width}x${s.height}, maxLevel=${serverMaxLevel})`);
    checks.forEach(c => console.log('  ' + c));
  }

  console.log('\n' + (allOk ? '✅ ALL MAPPINGS CONSISTENT' : '❌ MISMATCHES FOUND'));
  process.exit(allOk ? 0 : 1);
})();
