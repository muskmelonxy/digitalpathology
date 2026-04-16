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
const { initDatabase } = require('./database');

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

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/tiles', express.static(path.join(__dirname, '../uploads/tiles')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/slides', slideRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tiles', tileRoutes);

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
