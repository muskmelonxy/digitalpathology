/**
 * autoImport.js — Directory drop-in auto-import for digital slide files.
 *
 * Watch data/slides/ for new slide files (SVS/TIFF/JPEG/PNG/KFB/KFBIO).
 * When a file appears (and is fully written), it is:
 *   1. moved to uploads/slides/<uuid>.<ext> (same home as web uploads)
 *   2. registered in the slides table (uploaded_by = default teacher)
 *   3. processed through the same pyramid-tiling pipeline as web uploads
 *
 * On failure the DB row is removed and the file is moved back to data/slides/
 * so the next scan retries it.
 */
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { run, get } = require('../database');
const { processSlide, SUPPORTED_FORMATS } = require('./slideProcessor');

const DATA_DIR = path.join(__dirname, '../../data/slides');
const SLIDES_DIR = path.join(__dirname, '../../uploads/slides');

// Minimum file age (ms) before we consider it fully written
const MIN_AGE_MS = 10 * 1000;
// Debounce for watch events
const WATCH_DEBOUNCE_MS = 3000;
// Safety-net rescan interval (catches events the watcher missed)
const RESCAN_INTERVAL_MS = 60 * 1000;

let scanning = false;

async function getDefaultOwnerId() {
  const teacher = await get("SELECT id FROM users WHERE role = 'teacher' ORDER BY id LIMIT 1");
  if (teacher) return teacher.id;
  const admin = await get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  return admin ? admin.id : 1;
}

/**
 * Import a single file from the drop-in directory.
 * @returns {Promise<boolean>} true if processed (or attempted), false if skipped
 */
async function importFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return false;
  }

  const newName = `${uuidv4()}${ext}`;
  const destPath = path.join(SLIDES_DIR, newName);
  let slideId = null;

  try {
    // Move the original into the uploads area first — the pipeline assumes it
    // lives there (uploads/slides) like web uploads do.
    await fs.move(filePath, destPath, { overwrite: false });

    const ownerId = await getDefaultOwnerId();
    const name = path.basename(filePath, ext).replace(/_/g, ' ');
    const format = ext.replace('.', '');

    const result = await run(
      `INSERT INTO slides (name, description, filename, original_format, course_id, uploaded_by, tile_size, status)
       VALUES (?, '', ?, ?, NULL, ?, 256, 'processing')`,
      [name, newName, format, ownerId]
    );
    slideId = result.id;

    console.log(`[autoImport] "${name}" -> slide #${slideId} (${format}), processing...`);
    await processSlide(slideId, destPath, format, 256);
    return true;
  } catch (error) {
    console.error(`[autoImport] failed for ${filePath}:`, error.message);

    // Roll back: remove the DB row; move the file back marked .failed so it
    // is not retried forever (fix or delete it to stop seeing the marker).
    if (slideId !== null) {
      await run('DELETE FROM slides WHERE id = ?', [slideId]).catch(() => {});
    }
    if (await fs.pathExists(destPath)) {
      const failedPath = `${filePath}.failed`;
      await fs.move(destPath, failedPath, { overwrite: true }).catch(() => {});
      console.error(`[autoImport] bad file quarantined as ${failedPath}`);
    }
    return false;
  }
}

/**
 * Scan the drop-in directory and import anything new / old enough.
 */
async function scan() {
  if (scanning) return;
  scanning = true;
  let needRescan = false;

  try {
    await fs.ensureDir(DATA_DIR);
    const entries = await fs.readdir(DATA_DIR);

    for (const entry of entries) {
      const fullPath = path.join(DATA_DIR, entry);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch (e) {
        continue; // file vanished (already moved by a previous scan)
      }
      if (!stat.isFile()) continue;

      const ext = path.extname(entry).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext)) continue;

      // Skip files that are too fresh — probably still being copied in.
      if (Date.now() - stat.mtimeMs < MIN_AGE_MS) {
        needRescan = true;
        continue;
      }

      await importFile(fullPath);
    }
  } catch (error) {
    console.error('[autoImport] scan error:', error.message);
  } finally {
    scanning = false;
  }

  // If something was too fresh, come back shortly and try again.
  if (needRescan) {
    setTimeout(() => scan(), MIN_AGE_MS);
  }
}

/**
 * Watch the drop-in directory for new files and start the safety-net rescan.
 */
function watch() {
  fs.ensureDirSync(DATA_DIR);
  let timer = null;

  const scheduleScan = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, WATCH_DEBOUNCE_MS);
  };

  try {
    fs.watch(DATA_DIR, { persistent: true }, scheduleScan);
  } catch (error) {
    console.error('[autoImport] fs.watch failed (falling back to periodic rescan):', error.message);
  }

  setInterval(() => scan(), RESCAN_INTERVAL_MS);
}

/**
 * Kick everything off: initial scan + watcher.
 */
function initAutoImport() {
  fs.ensureDirSync(DATA_DIR);
  fs.ensureDirSync(SLIDES_DIR);
  scan();
  watch();
  console.log(`[autoImport] watching ${DATA_DIR}`);
}

module.exports = { initAutoImport, DATA_DIR };
