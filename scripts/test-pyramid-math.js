#!/usr/bin/env node
/**
 * Pure pyramid / OSD mapping checks — no DB, no images.
 */
const assert = require('assert');
const { calcMaxLevel, expectedGrid } = require('../server/utils/pyramid');

function osdToServer(osdLevel, maxLevel) {
  return maxLevel - osdLevel;
}

function osdNumTiles(width, height, tileSize, osdLevel) {
  const scale = Math.pow(2, osdLevel);
  return {
    x: Math.max(1, Math.ceil(width / scale / tileSize)),
    y: Math.max(1, Math.ceil(height / scale / tileSize))
  };
}

function check(width, height, tileSize = 256) {
  const maxLevel = calcMaxLevel(width, height, tileSize);
  for (let osdLevel = 0; osdLevel <= maxLevel; osdLevel++) {
    const serverLevel = osdToServer(osdLevel, maxLevel);
    const exp = expectedGrid(width, height, tileSize, serverLevel, maxLevel);
    const osd = osdNumTiles(width, height, tileSize, osdLevel);
    assert.strictEqual(exp.cols, osd.x, `cols mismatch osd=${osdLevel} server=${serverLevel}`);
    assert.strictEqual(exp.rows, osd.y, `rows mismatch osd=${osdLevel} server=${serverLevel}`);
  }
  // Home view (whole slide) uses the coarsest server level.
  const home = expectedGrid(width, height, tileSize, 0, maxLevel);
  assert.ok(home.cols * home.rows <= 4, `level 0 should be tiny, got ${home.cols}x${home.rows} for ${width}x${height}`);
  return maxLevel;
}

const cases = [
  [256, 256],
  [257, 256],
  [2000, 1400],
  [4096, 4096],
  [40000, 30000],
  [1024, 768],
];

for (const [w, h] of cases) {
  const ml = check(w, h);
  console.log(`ok  ${w}x${h} maxLevel=${ml}`);
}

assert.strictEqual(calcMaxLevel(2000, 1400, 256), 3);
assert.strictEqual(calcMaxLevel(256, 256, 256), 0);
console.log('ALL PYRAMID MATH CHECKS PASSED');
