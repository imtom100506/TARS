const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readSentenceStream } = require('../src/optimization/sentenceStream');

const token = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
function response(text, packet = Infinity) {
  const bytes = new TextEncoder().encode(text);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += packet) controller.enqueue(bytes.slice(offset, offset + packet));
    controller.close();
  }, cancel() { cancelled = true; } });
  return { body, get cancelled() { return cancelled; } };
}

test('SSE preserves split UTF-8 characters, CRLF events, usage and all complete sentences', async () => {
  const spoken = [];
  const input = response(': heartbeat\r\n\r\n' + token('¡Hola, comunidad! ') + token('Café y 😀.') +
    'data: {"choices":[],"usage":{"total_tokens":31}}\r\n\r\ndata: [DONE]\r\n\r\n', 1);
  const result = await readSentenceStream(input, { limit: 1500, onSentence: async text => spoken.push(text) });
  assert.deepEqual(spoken, ['¡Hola, comunidad!', 'Café y 😀.']);
  assert.deepEqual(result, { text: '¡Hola, comunidad! Café y 😀.', usage: 31 });
  assert.equal(input.body.locked, false);
});

test('SSE waits for each playback callback before emitting the next sentence', async () => {
  const spoken = []; let release;
  const pending = readSentenceStream(response(token('Uno. Dos.') + 'data: [DONE]\n\n'), {
    limit: 1500, onSentence: async text => {
      spoken.push(text); if (spoken.length === 1) await new Promise(resolve => { release = resolve; });
    },
  });
  await new Promise(setImmediate);
  assert.deepEqual(spoken, ['Uno.']); release(); await pending;
  assert.deepEqual(spoken, ['Uno.', 'Dos.']);
});

test('truncated or malformed SSE after audible content fails without permitting a repeated answer', async () => {
  for (const suffix of ['', 'data: {broken}\n\n', 'data: {"choices":[{"finish_reason":"length"}]}\n\n']) {
    const spoken = [];
    const input = response(token('Ya se oyó esto. ') + suffix);
    await assert.rejects(readSentenceStream(input, { limit: 1500, onSentence: async text => spoken.push(text) }), { code: 'AI_PARTIAL' });
    assert.deepEqual(spoken, ['Ya se oyó esto.']);
    assert.equal(input.body.locked, false);
  }
});

test('invalid oversized and empty SSE release readers and do not emit speech', async () => {
  for (const text of ['data: [DONE]\n\n', 'data: ' + 'x'.repeat(65536)]) {
    const input = response(text);
    await assert.rejects(readSentenceStream(input, { limit: 1500, onSentence: () => assert.fail('No speech expected') }));
    assert.equal(input.body.locked, false);
  }
  await assert.rejects(readSentenceStream({}, { limit: 100, onSentence() {} }), /sin stream/);
});

test('aborted SSE never invokes playback and unlocks the source', async () => {
  const controller = new AbortController(); controller.abort();
  const input = response(token('No debe sonar.') + 'data: [DONE]\n\n');
  await assert.rejects(readSentenceStream(input, { limit: 100, signal: controller.signal, onSentence: () => assert.fail('Aborted playback') }), { name: 'AbortError' });
  assert.equal(input.body.locked, false);
});
