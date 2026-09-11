const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs-extra');

const authRoutes = require('./routes/auth');
const slideRoutes = require('./routes/slides');
const courseRoutes = require('./routes/courses');
const uploadRoutes = require('./routes/upload');
const { tileMiddleware } = require('./utils/tileServe');
const tileRoutes = require('./routes/tiles');
const shareRoutes = require('./routes/share');
const systemRoutes = require('./routes/system');
const { initDatabase } = require('./database');
const { initAutoImport } = require('./utils/autoImport');
const { ensureOverview } = require('./utils/overview');
const { checkKfbRuntime } = require('./utils/kfbProcessor');

const app = express();
const PORT = process.env.PORT || 3001;

try {
  const sharp = require('sharp');
  const cpus = require('os').cpus().length || 2;
  sharp.concurrency(Math.max(1, cpus - 1));
  sharp.cache({ memory: 256, files: 20, items: 200 });
} catch (e) {
  console.warn('sharp init skipped:', e.message);
}

// Ensure directories exist
fs.ensureDirSync(path.join(__dirname, '../uploads/slides'));
fs.ensureDirSync(path.join(__dirname, '../uploads/tiles'));
fs.ensureDirSync(path.join(__dirname, '../uploads/thumbnails'));
fs.ensureDirSync(path.join(__dirname, '../uploads/overviews'));
fs.ensureDirSync(path.join(__dirname, '../uploads/temp'));
fs.ensureDirSync(path.join(__dirname, '../uploads/labels'));
fs.ensureDirSync(path.join(__dirname, '../uploads/macros'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Static files with caching.
// fallthrough:false so a missing tile is a real 404 (not the SPA index.html),
// which otherwise poisons OpenSeadragon's tile cache during pan/zoom.
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '1d',
  immutable: true,
  index: false,
  setHeaders(res, filePath) {
    if (/\.jpe?g$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    }
  }
}));
app.use('/tiles', tileMiddleware);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/slides', slideRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tiles', tileRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/system', systemRoutes);

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
    const kfb = checkKfbRuntime();
    if (kfb.ok) {
      console.log(`[kfb] runtime ok  dll=${kfb.dll}  libjpeg=${kfb.libjpeg9}`);
    } else {
      console.warn(`[kfb] runtime NOT ready:\n  - ${kfb.problems.join('\n  - ')}`);
    }
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
