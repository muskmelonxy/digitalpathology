const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { get, run } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { slideAssetFlags } = require('../utils/slideAssets');

// Build a share URL for a token
function buildShareUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/s/${token}`;
}

// Helper: load a slide and check the requesting user is owner/admin
async function loadOwnedSlide(id, user) {
  const slide = await get('SELECT * FROM slides WHERE id = ?', [id]);
  if (!slide) return { error: 404, msg: 'Slide not found' };
  if (slide.uploaded_by !== user.id && user.role !== 'admin') {
    return { error: 403, msg: 'Access denied' };
  }
  return { slide };
}

// ---- Public (no auth) viewer metadata, lookup by share token ----
// Registered BEFORE /:id so "/public/:token" is not captured as id="public".
router.get('/public/:token', async (req, res) => {
  try {
    const slide = await get(
      `SELECT s.*, c.name as course_name, u.username as uploaded_by_name
       FROM slides s
       LEFT JOIN courses c ON s.course_id = c.id
       LEFT JOIN users u ON s.uploaded_by = u.id
       WHERE s.share_token = ? AND s.status = 'ready'`,
      [req.params.token]
    );

    if (!slide) {
      return res.status(404).json({ error: 'Share link invalid or expired' });
    }

    res.json({
      id: slide.id,
      name: slide.name,
      description: slide.description,
      thumbnail_path: slide.thumbnail_path,
      gender: slide.gender,
      age: slide.age,
      diagnosis: slide.diagnosis,
      other_info: slide.other_info,
      case_no: slide.case_no,
      sampling_site: slide.sampling_site,
      institution: slide.institution,
      microscopic: slide.microscopic,
      ihc: slide.ihc,
      width: slide.width,
      height: slide.height,
      tile_size: slide.tile_size,
      max_level: slide.max_level,
      tiles_version: slide.tiles_version || 1,
      pyramid_complete: slide.pyramid_complete !== 0,
      micro_per_px: slide.micro_per_px,
      original_format: slide.original_format,
      course_name: slide.course_name,
      uploaded_by_name: slide.uploaded_by_name,
      created_at: slide.created_at,
      ...slideAssetFlags(slide.id)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Generate / refresh a share token for a slide (teacher/admin) ----
router.post('/:id', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const owned = await loadOwnedSlide(req.params.id, req.user);
    if (owned.error) return res.status(owned.error).json({ error: owned.msg });
    const slide = owned.slide;

    // Reuse existing token if already shared
    let token = slide.share_token;
    if (!token) {
      token = crypto.randomBytes(12).toString('hex'); // 24-char hex token
      await run('UPDATE slides SET share_token = ? WHERE id = ?', [token, slide.id]);
    }

    res.json({ token, url: buildShareUrl(req, token) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Get current share status ----
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const owned = await loadOwnedSlide(req.params.id, req.user);
    if (owned.error) return res.status(owned.error).json({ error: owned.msg });
    const slide = owned.slide;

    res.json({
      shared: !!slide.share_token,
      token: slide.share_token || null,
      url: slide.share_token ? buildShareUrl(req, slide.share_token) : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Disable sharing ----
router.delete('/:id', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const owned = await loadOwnedSlide(req.params.id, req.user);
    if (owned.error) return res.status(owned.error).json({ error: owned.msg });

    await run('UPDATE slides SET share_token = NULL WHERE id = ?', [req.params.id]);
    res.json({ shared: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
