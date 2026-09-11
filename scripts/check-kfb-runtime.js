#!/usr/bin/env node
/**
 * Verify KFB vendor runtime: decoder .so, blank JPEG, libjpeg.so.9, python script.
 * Does not require a .kfb sample. Exit 0 if the decoder can be loaded.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { checkKfbRuntime, kfbChildEnv, resolveVendorPaths } = require('../server/utils/vendorPaths');

const runtime = checkKfbRuntime();
console.log(JSON.stringify(runtime, null, 2));

const script = path.join(__dirname, '../server/utils/kfb_extract.py');
const help = spawnSync(runtime.python, [script, '-h'], { encoding: 'utf8', env: kfbChildEnv() });
if (help.status !== 0) {
  console.error('kfb_extract.py -h failed:', help.stderr || help.stdout);
  process.exit(1);
}
if (!help.stdout.includes('--dll')) {
  console.error('kfb_extract.py help missing --dll');
  process.exit(1);
}

const compile = spawnSync(runtime.python, ['-m', 'py_compile', script], { encoding: 'utf8' });
if (compile.status !== 0) {
  console.error(compile.stderr);
  process.exit(1);
}

if (!runtime.ok) {
  console.error('KFB runtime incomplete:');
  for (const p of runtime.problems) console.error(' -', p);
  process.exit(2);
}

const paths = resolveVendorPaths();
const ldd = spawnSync('ldd', [paths.dll], {
  encoding: 'utf8',
  env: kfbChildEnv()
});
console.log(ldd.stdout);
if (ldd.stdout.includes('libjpeg.so.9 => not found')) {
  console.error('libjpeg.so.9 still unresolved after LD_LIBRARY_PATH');
  process.exit(2);
}

// ctypes load of the vendor lib (no .kfb file)
const load = spawnSync(runtime.python, ['-c', `
import os, ctypes, sys
dll = ${JSON.stringify(paths.dll)}
jpeg = ${JSON.stringify(paths.libjpeg9)}
if jpeg:
    ctypes.CDLL(jpeg, mode=ctypes.RTLD_GLOBAL)
lib = ctypes.CDLL(dll)
print('loaded', dll)
`], { encoding: 'utf8', env: kfbChildEnv() });
if (load.status !== 0) {
  console.error('ctypes load failed:', load.stderr || load.stdout);
  process.exit(2);
}
console.log(load.stdout.trim());
console.log('KFB RUNTIME CHECK PASSED');
