const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function tileOrigin() {
  return new URL(process.env.WSI_TILE_URL || 'http://127.0.0.1:5001');
}

// Logged-in users only. The Python process stays on localhost.
router.use(authenticateToken);

router.use((req, res) => {
  const origin = tileOrigin();
  const transport = origin.protocol === 'https:' ? https : http;
  const upstream = transport.request(
    {
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port,
      method: req.method,
      path: req.url,
      headers: { accept: req.headers.accept || '*/*' },
      timeout: 120000,
    },
    (up) => {
      res.status(up.statusCode || 502);
      if (up.headers['content-type']) {
        res.set('Content-Type', up.headers['content-type']);
      }
      res.set('Cache-Control', up.headers['cache-control'] || 'private, max-age=60');
      up.pipe(res);
    }
  );

  upstream.on('timeout', () => upstream.destroy(new Error('tile service timeout')));
  upstream.on('error', () => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(503).json({
      error: 'WSI tile service is not running',
      hint: 'Start it with: python -m tile_server',
    });
  });
  upstream.end();
});

module.exports = router;
