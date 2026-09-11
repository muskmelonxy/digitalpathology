/**
 * Persistent KFB decoder workers. The vendor .so is not cheap to dlopen per
 * tile and is not thread-safe, so each open file gets one Python process
 * that keeps InitImageFileFunc alive and answers JSON-line tile requests.
 */
const { spawn } = require('child_process');
const path = require('path');
const { resolveVendorPaths, kfbChildEnv } = require('./vendorPaths');

const PYTHON = process.env.PFB_PYTHON || '/usr/bin/python3';
const SCRIPT = path.join(__dirname, 'kfb_extract.py');
const MAX_SESSIONS = Math.max(1, Number(process.env.KFB_WORKERS || 3));
const IDLE_MS = Number(process.env.KFB_WORKER_IDLE_MS || 5 * 60 * 1000);
const REQ_TIMEOUT_MS = Number(process.env.KFB_TILE_TIMEOUT_MS || 30000);

const sessions = new Map(); // filePath -> KfbSession
let sweeper = null;

function parseJsonLine(line) {
  const t = String(line || '').trim();
  if (!t.startsWith('{')) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

class KfbSession {
  constructor(filePath) {
    this.filePath = filePath;
    this.pending = new Map();
    this.nextId = 1;
    this.lastUsed = Date.now();
    this.stdoutBuf = '';
    this.stderrBuf = '';
    this.dead = false;

    const paths = resolveVendorPaths();
    const env = kfbChildEnv();
    this.proc = spawn(PYTHON, [
      SCRIPT, '--serve',
      '--dll', paths.dll,
      '--blank', paths.blank
    ], { env });

    this.proc.stdout.on('data', (buf) => {
      this.stdoutBuf += buf.toString('utf8');
      const lines = this.stdoutBuf.split('\n');
      this.stdoutBuf = lines.pop();
      for (const line of lines) this._onLine(line);
    });
    this.proc.stderr.on('data', (buf) => {
      this.stderrBuf += buf.toString('utf8');
      if (this.stderrBuf.length > 16 * 1024) {
        this.stderrBuf = this.stderrBuf.slice(-8 * 1024);
      }
    });
    this.proc.on('exit', (code) => {
      this.dead = true;
      const err = new Error(`kfb worker exited ${code}`);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      if (sessions.get(this.filePath) === this) sessions.delete(this.filePath);
    });
    this.proc.on('error', (err) => {
      this.dead = true;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    });

    this.opened = this.request({ cmd: 'open', path: filePath });
  }

  _onLine(line) {
    const obj = parseJsonLine(line);
    if (!obj) return;
    if (obj.event === 'warn') {
      console.warn('[kfb-worker]', obj.msg);
      return;
    }
    if (obj.event === 'ready' || obj.event === 'progress' || obj.event === 'header') {
      return;
    }
    if (obj.id == null) return;
    const p = this.pending.get(obj.id);
    if (!p) return;
    this.pending.delete(obj.id);
    clearTimeout(p.timer);
    if (obj.ok) p.resolve(obj);
    else p.reject(new Error(obj.error || 'kfb worker error'));
  }

  request(msg) {
    if (this.dead) return Promise.reject(new Error('kfb worker dead'));
    this.lastUsed = Date.now();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload = { ...msg, id };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`kfb worker timeout (${msg.cmd})`));
      }, REQ_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(JSON.stringify(payload) + '\n');
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  async tile(level, col, row, outPath) {
    await this.opened;
    return this.request({ cmd: 'tile', level, col, row, out: outPath });
  }

  destroy() {
    this.dead = true;
    try {
      this.proc.stdin.write(JSON.stringify({ cmd: 'quit', id: 0 }) + '\n');
    } catch (e) { /* ignore */ }
    setTimeout(() => {
      try { this.proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }, 1500);
  }
}

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, s] of sessions) {
      if (now - s.lastUsed > IDLE_MS) {
        s.destroy();
        sessions.delete(key);
      }
    }
  }, 30000);
  if (sweeper.unref) sweeper.unref();
}

function evictOldest() {
  let oldest = null;
  for (const [key, s] of sessions) {
    if (!oldest || s.lastUsed < oldest.s.lastUsed) oldest = { key, s };
  }
  if (oldest) {
    oldest.s.destroy();
    sessions.delete(oldest.key);
  }
}

async function getSession(filePath) {
  ensureSweeper();
  let s = sessions.get(filePath);
  if (s && !s.dead) {
    s.lastUsed = Date.now();
    return s;
  }
  if (s && s.dead) sessions.delete(filePath);
  while (sessions.size >= MAX_SESSIONS) evictOldest();
  s = new KfbSession(filePath);
  sessions.set(filePath, s);
  await s.opened;
  return s;
}

async function extractKfbTile(filePath, level, col, row, outPath) {
  const s = await getSession(filePath);
  return s.tile(level, col, row, outPath);
}

function closeAllWorkers() {
  for (const s of sessions.values()) s.destroy();
  sessions.clear();
}

module.exports = { extractKfbTile, getSession, closeAllWorkers };
