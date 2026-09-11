/**
 * kfbProcessor.js — official KFBIO decoder → standard pyramid
 * Depends on:
 *   - server/utils/kfb_extract.py
 *   - vendor/lib/libImageOperationLib.so
 *   - vendor/lib/libjpeg.so.9  (or system libjpeg.so.9)
 *   - vendor/blank_256.jpg
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { resolveVendorPaths, kfbChildEnv, checkKfbRuntime } = require('./vendorPaths');

const PYTHON = process.env.PFB_PYTHON || '/usr/bin/python3';
const SCRIPT = path.join(__dirname, 'kfb_extract.py');
const DEFAULT_TIMEOUT_MS = Number(process.env.KFB_TIMEOUT_MS || 30 * 60 * 1000);

function parseJsonLine(line) {
  const t = String(line || '').trim();
  if (!t.startsWith('{')) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

/**
 * Spawn the Python converter and stream JSON progress lines.
 * @param {string[]} args
 * @param {{onProgress?: Function}} opts
 * @returns {Promise<object>} final metadata JSON
 */
function runConverter(args, opts = {}) {
  const { onProgress } = opts;
  const timeoutMs = Number(opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    const env = kfbChildEnv();
    const child = spawn(PYTHON, args, { env });
    let stdoutBuf = '';
    let stderrBuf = '';
    let meta = null;
    let settled = false;

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      fail(new Error(`kfb converter timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const tail = String(stderrBuf || err.message || '').slice(-2000);
      reject(new Error(err.message + (tail && tail !== err.message ? `\n${tail}` : '')));
    };

    const succeed = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const consumeLine = (line) => {
      const obj = parseJsonLine(line);
      if (!obj) return;
      if (obj.event === 'progress' || obj.event === 'header') {
        if (onProgress) {
          try { onProgress(obj); } catch (e) { /* ignore UI progress errors */ }
        }
        return;
      }
      if (obj.event === 'error') {
        fail(new Error(obj.msg || 'kfb converter error'));
        return;
      }
      if (obj.event === 'warn') {
        console.warn('[kfb]', obj.msg);
        return;
      }
      if (obj.width && obj.maxLevel != null && obj.event == null) {
        meta = obj;
      }
    };

    child.stdout.on('data', (buf) => {
      stdoutBuf += buf.toString('utf8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on('data', (buf) => {
      stderrBuf += buf.toString('utf8');
      if (stderrBuf.length > 64 * 1024) {
        stderrBuf = stderrBuf.slice(-32 * 1024);
      }
    });
    child.on('error', (err) => {
      fail(new Error(`failed to start ${PYTHON}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (stdoutBuf.trim()) consumeLine(stdoutBuf);
      if (settled) return;
      if (code !== 0) {
        return fail(new Error(`kfb converter exited ${code}`));
      }
      if (!meta) {
        return fail(new Error('kfb converter returned no metadata JSON'));
      }
      succeed(meta);
    });
  });
}

async function makeThumbnail(meta, slideId, tilesDir, thumbDir) {
  try {
    const ideal = Math.max(0, Math.min(meta.maxLevel,
      Math.round(meta.maxLevel - Math.log2(Math.max(meta.width, 1) / 400))));
    let lv = ideal;
    if (!fs.existsSync(path.join(tilesDir, String(lv)))) {
      const existing = (await fs.readdir(tilesDir)).filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
      if (!existing.length) return null;
      lv = existing.reduce((best, n) => Math.abs(n - ideal) < Math.abs(best - ideal) ? n : best, existing[0]);
    }
    const dir = path.join(tilesDir, String(lv));
    if (!fs.existsSync(dir)) return null;
    const files = (await fs.readdir(dir)).filter(f => /^\d+_\d+\.jpg$/.test(f));
    const coords = files.map(f => {
      const m = f.match(/^(\d+)_(\d+)\.jpg$/);
      return { c: +m[1], r: +m[2], file: path.join(dir, f) };
    });
    if (!coords.length) return null;
    const ncols = Math.max(...coords.map(x => x.c)) + 1;
    const nrows = Math.max(...coords.map(x => x.r)) + 1;
    const W = 256 * ncols, H = 256 * nrows;
    const layers = [];
    for (const x of coords) {
      layers.push({ input: await sharp(x.file).png().toBuffer(), left: x.c * 256, top: x.r * 256 });
    }
    const canvas = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 245, g: 245, b: 245 } }
    }).composite(layers).jpeg({ quality: 80 }).toBuffer();
    await fs.ensureDir(thumbDir);
    const out = path.join(thumbDir, `${slideId}.jpg`);
    await sharp(canvas).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 80 }).toFile(out);
    return `/uploads/thumbnails/${slideId}.jpg`;
  } catch (e) {
    console.error(`[kfb] thumbnail failed slide ${slideId}:`, e.message);
    return null;
  }
}

async function processKFB(slideId, filePath, uploadsDir, opts = {}) {
  const runtime = checkKfbRuntime();
  if (!runtime.ok) {
    throw new Error(`KFB runtime not ready: ${runtime.problems.join('; ')}`);
  }
  const paths = resolveVendorPaths();
  const tilesRoot = path.join(uploadsDir, 'tiles');
  await fs.ensureDir(tilesRoot);

  const args = [
    SCRIPT,
    '--kfb', filePath,
    '--tid', String(slideId),
    '--tiledir', tilesRoot,
    '--dll', paths.dll,
    '--blank', paths.blank
  ];
  if (process.env.KFB_CROP_CONTENT === '1') args.push('--crop-content');

  let viewableNotified = false;
  const meta = await runConverter(args, {
    onProgress: async (evt) => {
      if (opts.onProgress) {
        await opts.onProgress(evt);
      }
      if (evt.viewable && !viewableNotified && opts.onViewable) {
        viewableNotified = true;
        try { await opts.onViewable(evt); } catch (e) {
          console.error('[kfb] onViewable failed:', e.message);
        }
      }
    }
  });

  const slideTilesDir = path.join(tilesRoot, String(slideId));
  const thumb = await makeThumbnail(meta, slideId, slideTilesDir, path.join(uploadsDir, 'thumbnails'));
  meta.thumbnailPath = thumb;
  return meta;
}

module.exports = { processKFB, runConverter, makeThumbnail, checkKfbRuntime };
