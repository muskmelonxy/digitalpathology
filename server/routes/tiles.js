const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { get } = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get tile image
router.get('/:slideId/:level/:col/:row.jpg', authenticateToken, async (req, res) => {
  try {
    const { slideId, level, col, row } = req.params;

    // Check slide exists and user has access
    const slide = await get('SELECT * FROM slides WHERE id = ?', [slideId]);

    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    if (slide.status !== 'ready') {
      return res.status(400).json({ error: 'Slide not ready' });
    }

    // Check access for students
    if (req.user.role === 'student') {
      const enrollment = await get(
        'SELECT * FROM enrollments WHERE course_id = ? AND student_id = ?',
        [slide.course_id, req.user.id]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const tilePath = path.join(__dirname, '../../uploads/tiles', slideId, level, `${col}_${row}.jpg`);

    // Check if tile exists
    if (!fs.existsSync(tilePath)) {
      console.log(`Tile not found: ${tilePath}`);
      // Return blank tile
      const blankPath = path.join(__dirname, '../../uploads/blank.jpg');
      if (fs.existsSync(blankPath)) {
        return res.sendFile(blankPath);
      }
      return res.status(404).json({ error: 'Tile not found' });
    }

    res.sendFile(tilePath);
  } catch (error) {
    console.error('Error serving tile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get thumbnail
router.get('/:slideId/thumbnail.jpg', authenticateToken, async (req, res) => {
  try {
    const { slideId } = req.params;

    const slide = await get('SELECT * FROM slides WHERE id = ?', [slideId]);

    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    // Check access for students
    if (req.user.role === 'student') {
      const enrollment = await get(
        'SELECT * FROM enrollments WHERE course_id = ? AND student_id = ?',
        [slide.course_id, req.user.id]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const thumbnailPath = path.join(__dirname, '../../uploads/thumbnails', `${slideId}.jpg`);

    if (!fs.existsSync(thumbnailPath)) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }

    res.sendFile(thumbnailPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
