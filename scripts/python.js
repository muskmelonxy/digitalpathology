const fs = require('fs');
const path = require('path');

function pythonBin() {
  const root = path.join(__dirname, '..');
  const venvPython = process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

module.exports = { pythonBin };
