const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs-extra');

const authRoutes = require('./routes/auth');
const slideRoutes = require('./routes/slides');
const courseRoutes = require('./routes/courses');
const uploadRoutes = require('./routes/upload');
const tileRoutes = require('./routes/tiles');
const shareRoutes = require('./routes/share');
const { initDatabase } = require('./database');
const { initAutoImport } = require('./utils/autoImport');
const { ensureOverview } = require('./utils/overview');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure directories exist
fs.ensureDirSync(path.join(__dirname, '../uploads/slides'));
fs.ensureDirSync(path.join(__dirname, '../uploads/tiles'));
fs.ensureDirSync(path.join(__dirname, '../uploads/thumbnails'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Static files with caching
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '1d',
  immutable: true
}));
app.use('/tiles', express.static(path.join(__dirname, '../uploads/tiles'), {
  maxAge: '7d',
  immutable: true
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/slides', slideRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tiles', tileRoutes);
app.use('/api/share', shareRoutes);

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build'), {
    // HTML 禁用缓存, 保证每次刷新都能拿到最新 bundle/瓦片版本
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// Initialize database and start server
initDatabase().then(() => {
  // Start directory auto-import (data/slides drop-in)
  initAutoImport();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Pre-build crisp whole-slide overviews for ready slides (background, non-blocking).
  // Idempotent: skips slides that already have an overview. New files only.
  (async () => {
    try {
      const { query } = require('./database');
      const ready = await query("SELECT * FROM slides WHERE status = 'ready'");
      let built = 0;
      for (const s of ready) {
        try { if (await ensureOverview(s)) built++; }
        catch (e) { console.error(`Overview failed slide ${s.id}:`, e.message); }
      }
      console.log(`Overview prebuild done: ${built}/${ready.length} slides`);
    } catch (e) {
      console.error('Overview prebuild error:', e.message);
    }
  })();
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
