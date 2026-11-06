const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
let checked = 0;
for (const file of ['src', 'test', 'scripts'].flatMap(dir => files(path.join(root, dir)))) {
  if (!/\.[cm]?js$/.test(file)) continue;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || result.stderr);
    process.exitCode = 1;
  }
  checked++;
}
for (const file of ['package.json', 'package-lock.json', ...files(path.join(root, 'config')).map(file => path.relative(root, file))]) {
  if (!file.endsWith('.json')) continue;
  try { JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { console.error(`${file}: ${error.message}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`Sintaxis y configuración correctas: ${checked} archivos JavaScript.`);
