// Verificación local del contenedor: sin credenciales, conexión a Discord ni API de pago.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.getuid) assert.notEqual(process.getuid(), 0, 'El contenedor debe ejecutarse sin root.');
const dir = path.resolve(__dirname, '../data');
const probe = path.join(dir, `.smoke-${process.pid}`);
try { fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 }); assert.equal(fs.readFileSync(probe, 'utf8'), 'ok'); }
finally { if (fs.existsSync(probe)) fs.unlinkSync(probe); }
require('../src/botCapabilities');
require('../src/aiClient');
console.log('Contenedor operativo: módulos cargados y datos escribibles sin privilegios.');
