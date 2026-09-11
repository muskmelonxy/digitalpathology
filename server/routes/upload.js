const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { run, get } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { processSlide, SUPPORTED_FORMATS } = require('../utils/slideProcessor');

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/slides'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (SUPPORTED_FORMATS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit for large slide files
  }
});

// Upload slide
router.post('/', authenticateToken, requireRole('teacher', 'admin'), upload.single('slide'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description, course_id, tile_size = 256, gender, age, diagnosis, other_info } = req.body;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const originalFormat = fileExt.replace('.', '');

    // Create database entry
    const result = await run(
      `INSERT INTO slides (name, description, filename, original_format, course_id, uploaded_by, tile_size, status,
         gender, age, diagnosis, other_info, processing_progress, processing_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        name || req.file.originalname,
        description || '',
        req.file.filename,
        originalFormat,
        course_id || null,
        req.user.id,
        parseInt(tile_size) || 256,
        'processing',
        gender || '',
        age || '',
        diagnosis || '',
        other_info || '',
        originalFormat === 'kfb' || originalFormat === 'kfbio'
          ? 'Queued — native KFB decode'
          : 'Queued — building pyramid'
      ]
    );

    const slideId = result.id;

    // Start processing in background
    processSlide(slideId, req.file.path, originalFormat, tile_size);

    res.status(201).json({
      id: slideId,
      message: 'Upload successful, processing started',
      status: 'processing'
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      fs.removeSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Get upload status
router.get('/status/:id', authenticateToken, async (req, res) => {
  try {
    const slide = await get(
      `SELECT id, status, name, original_format, processing_progress, processing_message,
              error_message, pyramid_complete, tiles_version, width, height, max_level
       FROM slides WHERE id = ?`,
      [req.params.id]
    );
    if (!slide) {
      return res.status(404).json({ error: 'Slide not found' });
    }
    res.json(slide);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
