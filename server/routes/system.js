const express = require('express');
const router = express.Router();
const { checkKfbRuntime } = require('../utils/kfbProcessor');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.get('/kfb', authenticateToken, requireRole('teacher', 'admin'), (req, res) => {
  res.json(checkKfbRuntime());
});

module.exports = router;
