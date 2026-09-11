/**
 * Resolve KFB vendor assets relative to the repo (with VPS-path fallbacks).
 * Production historically hardcoded /www/digitalpathology/... which breaks any
 * other checkout and makes .kfb look like a convert/wait/fail path.
 */
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '../..');
const VENDOR_DIR = path.join(REPO_ROOT, 'vendor');
const VENDOR_LIB = path.join(VENDOR_DIR, 'lib');
const PROD_ROOT = '/www/digitalpathology';

function firstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return path.resolve(p);
  }
  const fallback = candidates.find(Boolean);
  return fallback ? path.resolve(fallback) : null;
}

function resolveVendorPaths() {
  const dll = firstExisting([
    process.env.KFB_DLL,
    path.join(VENDOR_LIB, 'libImageOperationLib.so'),
    path.join(PROD_ROOT, 'vendor/lib/libImageOperationLib.so')
  ]);
  const blank = firstExisting([
    process.env.KFB_BLANK,
    path.join(VENDOR_DIR, 'blank_256.jpg'),
    path.join(REPO_ROOT, 'uploads/blank.jpg'),
    path.join(PROD_ROOT, 'vendor/blank_256.jpg')
  ]);
  const libjpeg9Candidate = firstExisting([
    process.env.KFB_LIBJPEG,
    path.join(VENDOR_LIB, 'libjpeg.so.9'),
    '/usr/lib/x86_64-linux-gnu/libjpeg.so.9',
    '/usr/lib/libjpeg.so.9'
  ]);
  const libjpeg9 = libjpeg9Candidate && fs.existsSync(libjpeg9Candidate) ? libjpeg9Candidate : null;

  return {
    repoRoot: REPO_ROOT,
    vendorDir: VENDOR_DIR,
    libDir: VENDOR_LIB,
    dll,
    blank,
    libjpeg9,
    dllExists: !!(dll && fs.existsSync(dll)),
    blankExists: !!(blank && fs.existsSync(blank))
  };
}

function kfbChildEnv(extra = {}) {
  const paths = resolveVendorPaths();
  const ld = [paths.libDir];
  if (process.env.LD_LIBRARY_PATH) ld.push(process.env.LD_LIBRARY_PATH);
  return {
    ...process.env,
    CONDA_NO_PLUGINS: 'true',
    KFB_BLANK: paths.blank || '',
    KFB_DLL: paths.dll || '',
    LD_LIBRARY_PATH: ld.filter(Boolean).join(':'),
    ...extra
  };
}

function checkKfbRuntime() {
  const paths = resolveVendorPaths();
  const python = process.env.PFB_PYTHON || '/usr/bin/python3';
  const problems = [];
  if (!paths.dllExists) problems.push(`KFB decoder missing (${paths.dll || 'no path'})`);
  if (!paths.blankExists) problems.push(`blank tile JPEG missing (${paths.blank || 'no path'})`);
  if (!paths.libjpeg9) {
    problems.push('libjpeg.so.9 not found — vendor libImageOperationLib.so will fail to load. Run scripts/install-kfb-deps.sh or place libjpeg.so.9 in vendor/lib/');
  }
  return {
    ok: problems.length === 0,
    python,
    dll: paths.dll,
    dllExists: paths.dllExists,
    blank: paths.blank,
    blankExists: paths.blankExists,
    libjpeg9: paths.libjpeg9,
    libDir: paths.libDir,
    problems
  };
}

module.exports = {
  REPO_ROOT,
  VENDOR_DIR,
  VENDOR_LIB,
  resolveVendorPaths,
  kfbChildEnv,
  checkKfbRuntime
};
