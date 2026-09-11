// verify-slides.js — wait for auto-import to finish, then verify the 3 real SVS slides
// can be read end-to-end: DB row, viewer info API, tile files, tile HTTP fetches.
const { query } = require('./server/database');
const fs = require('fs');
const path = require('path');

const API = 'http://localhost:3001';
const TARGET_IDS = [10, 11, 12];

async function waitImport(timeoutSec = 420) {
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    const pending = fs.readdirSync('data/slides').filter(f => !f.startsWith('.'));
    const row = await query("SELECT id, status FROM slides WHERE id = 12");
    if (pending.length === 0 && row.length && row[0].status === 'ready') return { ok: true, msg: 'slide #12 ready' };
    if (row.length && row[0].status === 'error') return { ok: false, msg: 'slide #12 status=error' };
    await new Promise(r => setTimeout(r, 20000));
  }
  const pending = fs.readdirSync('data/slides').filter(f => !f.startsWith('.'));
  return { ok: false, msg: `timeout, data/slides still has: ${pending.join(', ') || '(empty)'}` };
}

async function verify() {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: 'teacher123' })
  });
  const { token } = await login.json();
  if (!token) { console.log('LOGIN_FAILED'); return; }

  const slides = await query(
    'SELECT id, name, status, width, height, max_level, thumbnail_path FROM slides WHERE id IN (?,?,?) ORDER BY id',
    TARGET_IDS
  );

  for (const s of slides) {
    const infoRes = await fetch(`${API}/api/slides/${s.id}/info`, { headers: { Authorization: `Bearer ${token}` } });
    const info = await infoRes.json();

    const tileDir = path.join('uploads/tiles', String(s.id));
    const levelCounts = {};
    if (fs.existsSync(tileDir)) {
      for (const lv of fs.readdirSync(tileDir)) {
        if (/^\d+$/.test(lv)) {
          levelCounts[lv] = fs.readdirSync(path.join(tileDir, lv)).filter(f => f.endsWith('.jpg')).length;
        }
      }
    }

    const levels = Object.keys(levelCounts).map(Number).sort((a, b) => a - b);
    const sampleUrls = [0, Math.floor(levels.length / 2), levels[levels.length - 1]]
      .map(lv => `${API}/tiles/${s.id}/${lv}/0_0.jpg`);
    const tileCodes = [];
    for (const u of sampleUrls) {
      const r = await fetch(u);
      tileCodes.push(r.status);
    }
    const thumbCode = (await fetch(API + s.thumbnail_path)).status;

    console.log(JSON.stringify({
      id: s.id, name: s.name, status: s.status,
      dimension: `${s.width}x${s.height}`, maxLevel: s.max_level,
      viewerInfo: info, tilesPerLevel: levelCounts,
      sampleTileHTTP: tileCodes, thumbnailHTTP: thumbCode
    }));
  }
}

(async () => {
  const res = await waitImport();
  console.log('IMPORT_RESULT:', JSON.stringify(res));
  await verify();
  process.exit(0);
})();
