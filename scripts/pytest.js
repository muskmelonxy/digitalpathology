const { spawn } = require('child_process');
const path = require('path');
const { pythonBin } = require('./python');

const child = spawn(pythonBin(), ['-m', 'pytest', 'tile_server/tests', '-q'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code == null ? 1 : code));
