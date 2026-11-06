// Verificación local del contenedor: sin credenciales, conexión a Discord ni API de pago.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createWakeFactory, ttsConfig } = require('../src/localSpeech');

if (process.getuid) assert.notEqual(process.getuid(), 0, 'El contenedor debe ejecutarse sin root.');
const dir = path.resolve(__dirname, '../data');
const probe = path.join(dir, `.smoke-${process.pid}`);
try { fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 }); assert.equal(fs.readFileSync(probe, 'utf8'), 'ok'); }
finally { if (fs.existsSync(probe)) fs.unlinkSync(probe); }
for (const [program, args] of [['ffmpeg', ['-version']], ['espeak-ng', ['--version']]]) {
  execFileSync(program, args, { timeout: 10000, windowsHide: true, stdio: 'pipe' });
}
const factory = createWakeFactory({ TARS_WAKE_ENABLED: 'true' });
const detector = factory();
assert.equal(detector.process(new Int16Array(detector.frameLength)), -1);
detector.release(); factory.dispose();
ttsConfig();
const output = execFileSync(process.execPath, [path.resolve(__dirname, '../src/ttsLocal.js'), 'TARS operativo.'], {
  timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
});
assert.equal(output.subarray(0, 4).toString(), 'RIFF');
assert.ok(output.length > 44, 'La voz neural debe producir audio.');
console.log('Contenedor operativo: usuario sin privilegios, datos escribibles, binarios y modelos de voz verificados.');
