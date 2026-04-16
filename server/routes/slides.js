const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Get all slides (with access control)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let slides;

    if (req.user.role === 'teacher' || req.user.role === 'admin') {
      // Teachers see their own slides or all slides in their courses
      slides = await query(`
        SELECT s.*, c.name as course_name, u.username as uploaded_by_name
        FROM slides s
        LEFT JOIN courses c ON s.course_id = c.id
        LEFT JOIN users u ON s.uploaded_by = u.id
        WHERE s.uploaded_by = ? OR c.teacher_id = ?
        ORDER BY s.created_at DESC
      `, [req.user.id, req.user.id]);
    } else {
      // Students see slides from enrolled courses
      slides = await query(`
        SELECT s.*, c.name as course_name, u.username as uploaded_by_name
        FROM slides s
        JOIN courses c ON s.course_id = c.id
        JOIN enrollments e ON c.id = e.course_id
        LEFT JOIN users u ON s.uploaded_by = u.id
        WHERE e.student_id = ? AND s.status = 'ready'
        ORDER BY s.created_at DESC
      `, [req.user.id]);
    }

    res.json(slides);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single slide
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const slide = await get(`
      SELECT s.*, c.name as course_name, u.username as uploaded_by_name
      FROM slides s
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN users u ON s.uploaded_by = u.id
      WHERE s.id = ?
    `, [req.params.id]);

    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    // Check access
    if (req.user.role === 'student') {
      const enrollment = await get(
        'SELECT * FROM enrollments WHERE course_id = ? AND student_id = ?',
        [slide.course_id, req.user.id]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(slide);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get slide info for viewer (dimensions, tile info)
router.get('/:id/info', authenticateToken, async (req, res) => {
  try {
    const slide = await get('SELECT * FROM slides WHERE id = ?', [req.params.id]);

    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    if (slide.status !== 'ready') {
      return res.status(400).json({ error: 'Slide not ready' });
    }

    // Check access
    if (req.user.role === 'student') {
      const enrollment = await get(
        'SELECT * FROM enrollments WHERE course_id = ? AND student_id = ?',
        [slide.course_id, req.user.id]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({
      width: slide.width,
      height: slide.height,
      tileSize: slide.tile_size,
      maxLevel: slide.max_level,
      format: 'jpg'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update slide
router.put('/:id', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { name, description, course_id } = req.body;

    const slide = await get('SELECT * FROM slides WHERE id = ?', [req.params.id]);
    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    // Only owner or admin can update
    if (slide.uploaded_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await run(
      'UPDATE slides SET name = ?, description = ?, course_id = ? WHERE id = ?',
      [name, description, course_id || null, req.params.id]
    );

    const updated = await get('SELECT * FROM slides WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete slide
router.delete('/:id', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const slide = await get('SELECT * FROM slides WHERE id = ?', [req.params.id]);
    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    // Only owner or admin can delete
    if (slide.uploaded_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete from database
    await run('DELETE FROM slides WHERE id = ?', [req.params.id]);

    // Note: Files will be cleaned up by a separate process or left for manual cleanup

    res.json({ message: 'Slide deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
