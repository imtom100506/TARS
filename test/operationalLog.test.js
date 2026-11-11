const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOperationalLog } = require('../src/operationalLog');
test('DM logs and cross-guild logs never reach a server, including nested asynchronous work', async () => {
  const sent = [], fetched = [];
  const log = createOperationalLog({ channels: { fetch: async id => {
    fetched.push(id); return { guildId: '100', isTextBased: () => true, send: async p => sent.push(p) };
  } } }, { LOG_CHANNEL_ID: '300' });
  await log.withContext({ guild: null }, async () => { await Promise.resolve(); await log('mensaje', { servidor_id: '100', mensaje: 'DM secreto' }); });
  assert.equal(fetched.length, 0);
  await log.withContext({ guild: { id: '200' } }, () => log('mensaje', { mensaje: 'privado' }));
  assert.equal(sent.length, 0);
  await log.withContext({ guild: { id: '100' } }, async () => {
    await Promise.resolve(); await log('comando', { usuario_id: '400', mensaje: 'texto secreto', respuesta: 'respuesta secreta', error: 'token secreto' });
  });
  assert.equal(sent.length, 1); assert.match(sent[0].content, /usuario_id: 400/);
  assert.ok(sent[0].content.startsWith('```\n') && sent[0].content.endsWith('\n```'));
  assert.doesNotMatch(sent[0].content, /secreto|secreta/); assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});

test('conversation logs include the literal username, message and TARS response in code blocks', async () => {
  const sent = [];
  const log = createOperationalLog({ channels: { fetch: async () => ({ guildId: '100', isTextBased: () => true, send: async p => sent.push(p) }) } }, { LOG_CHANNEL_ID: '300' });
  await log.withContext({ guild: { id: '100' } }, async () => {
    await log('mensaje', { usuario: 'Tom', mensaje: '  !tars hola\n@everyone **texto**  ' });
    await log('respuesta', { usuario: 'Tom', respuesta: 'Hola, Tom.\nRespuesta literal.' });
  });
  assert.deepEqual(sent.map(p => p.content), [
    '```\nuser: Tom\nmessage:   !tars hola\n@everyone **texto**  \n```',
    "```\nTARS's response to Tom: Hola, Tom.\nRespuesta literal.\n```",
  ]);
  for (const payload of sent) assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('long logs and embedded backticks remain complete and inside code blocks', async () => {
  const sent = [];
  const log = createOperationalLog({ channels: { fetch: async () => ({ guildId: '100', isTextBased: () => true, send: async p => sent.push(p.content) }) } }, { LOG_CHANNEL_ID: '300' });
  const response = '🙂'.repeat(1600) + '\n```js\nconst value = `literal`;\n```\nfin';
  await log.withContext({ guild: { id: '100' } }, () => log('respuesta', { usuario: 'Tom', respuesta: response }));
  assert.ok(sent.length > 1);
  for (const block of sent) {
    assert.ok(block.length <= 2000);
    assert.ok(block.startsWith('```\n') && block.endsWith('\n```'));
    assert.ok(!block.slice(4, -4).includes('```'));
  }
  assert.equal(sent.map(block => block.slice(4, -4)).join(''), `TARS's response to Tom: ${response}`);
});
test('parallel request contexts stay isolated and configured destinations are validated', async () => {
  const sent = [];
  const log = createOperationalLog({ channels: { fetch: async id => ({ guildId: id, isTextBased: () => true, send: async p => sent.push([id, p.content]) }) } },
    { TARS_LOG_CHANNELS: JSON.stringify({ '100': '100', '200': '200' }) });
  await Promise.all(['100', '200'].map(id => log.withContext({ guild: { id } }, async () => {
    await new Promise(resolve => setImmediate(resolve)); await log('moderacion', { usuario_id: id });
  })));
  assert.equal(sent.length, 2); for (const [id, content] of sent) assert.match(content, new RegExp(`usuario_id: ${id}\\nservidor_id: ${id}`));
});
