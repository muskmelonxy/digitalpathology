const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

function tileOrigin() {
  return new URL(process.env.WSI_TILE_URL || 'http://127.0.0.1:5001');
}

// Logged-in users only. The Python process stays on localhost.
router.use(authenticateToken);

// Teachers and admins may edit clinical notes. The proxy below forwards the body.
router.put(
  '/r/:root/:filename/clinical',
  requireRole('teacher', 'admin'),
  (req, res, next) => {
    const name = req.user && req.user.username ? String(req.user.username) : '';
    req.headers['x-updated-by'] = name.slice(0, 200);
    next();
  }
);

router.use((req, res) => {
  const origin = tileOrigin();
  const transport = origin.protocol === 'https:' ? https : http;
  const headers = { accept: req.headers.accept || '*/*' };
  let payload = null;
  if (req.method === 'PUT' || req.method === 'POST' || req.method === 'PATCH') {
    payload = Buffer.from(JSON.stringify(req.body ?? {}));
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(payload.length);
    if (req.headers['x-updated-by']) {
      headers['x-updated-by'] = String(req.headers['x-updated-by']).slice(0, 200);
    }
  }
  const upstream = transport.request(
    {
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port,
      method: req.method,
      path: req.url,
      headers,
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
  if (payload) upstream.end(payload);
  else upstream.end();
});

module.exports = router;
