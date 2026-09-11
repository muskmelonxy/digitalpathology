/**
 * Processing status helpers. Keeps upload/viewer polling cheap: one UPDATE
 * per milestone rather than per-tile chatter.
 */
const { run } = require('../database');

async function setProgress(slideId, pct, message) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  await run(
    `UPDATE slides SET processing_progress = ?, processing_message = ? WHERE id = ?`,
    [n, message ? String(message).slice(0, 500) : '', slideId]
  );
}

async function setError(slideId, message) {
  const msg = String(message || 'Processing failed').slice(0, 2000);
  await run(
    `UPDATE slides SET status = 'error', error_message = ?, processing_progress = 0, processing_message = ? WHERE id = ?`,
    [msg, msg.slice(0, 500), slideId]
  );
}

/**
 * Slide is viewable at home/low zoom (coarse tiles exist). High magnification
 * may still be generating (pyramid_complete = 0).
 */
async function markViewable(slideId, fields) {
  const {
    width,
    height,
    maxLevel,
    thumbnailPath = null,
    microPerPx = null,
    tilesVersion = 1,
    message = 'Preview ready — finishing high-resolution tiles…'
  } = fields;
  await run(
    `UPDATE slides SET
       status = 'ready',
       pyramid_complete = 0,
       width = ?, height = ?, max_level = ?,
       thumbnail_path = COALESCE(?, thumbnail_path),
       micro_per_px = COALESCE(?, micro_per_px),
       tiles_version = ?,
       processing_progress = CASE WHEN processing_progress > 55 THEN processing_progress ELSE 55 END,
       processing_message = ?
     WHERE id = ?`,
    [width, height, maxLevel, thumbnailPath, microPerPx, tilesVersion, message, slideId]
  );
}

async function markComplete(slideId, fields = {}) {
  const {
    width = null,
    height = null,
    maxLevel = null,
    thumbnailPath = null,
    microPerPx = null,
    tilesVersion = null
  } = fields;
  await run(
    `UPDATE slides SET
       status = 'ready',
       pyramid_complete = 1,
       processing_progress = 100,
       processing_message = 'Ready',
       width = COALESCE(?, width),
       height = COALESCE(?, height),
       max_level = COALESCE(?, max_level),
       thumbnail_path = COALESCE(?, thumbnail_path),
       micro_per_px = COALESCE(?, micro_per_px),
       tiles_version = COALESCE(?, tiles_version)
     WHERE id = ?`,
    [width, height, maxLevel, thumbnailPath, microPerPx, tilesVersion, slideId]
  );
}

module.exports = {
  setProgress,
  setError,
  markViewable,
  markComplete
};
