const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const test = require('node:test');
const { JWT_SECRET } = require('./middleware/auth');

function tokenFor(role, username) {
  return jwt.sign({ id: 1, username, role }, JWT_SECRET, { expiresIn: '1h' });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function request(port, { method, path, token, body }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? {
              'content-type': 'application/json',
              'content-length': payload.length,
            }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch (err) {
            json = null;
          }
          resolve({ status: res.statusCode, json, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

test('clinical PUT is role-gated and the JSON body is forwarded', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      seen.push({
        method: req.method,
        url: req.url,
        body: raw,
        updatedBy: req.headers['x-updated-by'] || '',
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, echoed: raw }));
    });
  });
  const upstreamPort = await listen(upstream);
  process.env.WSI_TILE_URL = `http://127.0.0.1:${upstreamPort}`;

  const app = express();
  app.use(express.json());
  app.use('/api/wsi', require('./routes/wsi'));
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const slide = '/api/wsi/r/library/case.svs/clinical';
    const anon = await request(port, { method: 'PUT', path: slide, body: { notes: 'x' } });
    assert.strictEqual(anon.status, 401);

    const student = await request(port, {
      method: 'PUT',
      path: slide,
      token: tokenFor('student', 'student'),
      body: { notes: 'secret' },
    });
    assert.strictEqual(student.status, 403);
    assert.strictEqual(seen.length, 0);

    const teacher = await request(port, {
      method: 'PUT',
      path: slide,
      token: tokenFor('teacher', 'teacher'),
      body: { case_title: '教学病例', notes: '无标识' },
    });
    assert.strictEqual(teacher.status, 200);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].method, 'PUT');
    assert.strictEqual(seen[0].url, '/r/library/case.svs/clinical');
    assert.strictEqual(seen[0].updatedBy, 'teacher');
    assert.deepStrictEqual(JSON.parse(seen[0].body), {
      case_title: '教学病例',
      notes: '无标识',
    });

    const reader = await request(port, {
      method: 'GET',
      path: slide,
      token: tokenFor('student', 'student'),
    });
    assert.strictEqual(reader.status, 200);
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(seen[1].method, 'GET');
    assert.strictEqual(seen[1].body, '');
  } finally {
    server.close();
    upstream.close();
  }
});
