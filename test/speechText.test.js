const { test } = require('node:test');
const assert = require('node:assert/strict');
const { speechChunks, speechText } = require('../src/speechText');

test('speech chunks keep all ordinary text, split at sentence boundaries and normalize markup', () => {
  const input = '**Hola.** ' + 'Una frase completa con información relevante. '.repeat(20) + 'Fin.';
  const chunks = speechChunks(input);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 280 && chunk.isWellFormed()));
  assert.equal(chunks.join(' '), speechText(input));
  assert.equal(speechText('Lee https://example.test. Hola\n mundo.'), 'Lee Hola mundo.');
});

test('speech chunking preserves Unicode and bounds unusually long generation', () => {
  const chunks = speechChunks('a'.repeat(279) + '😀' + 'x'.repeat(600));
  assert.ok(chunks.every(chunk => chunk.length <= 280 && chunk.isWellFormed()));
  assert.equal(chunks.join(''), 'a'.repeat(279) + '😀' + 'x'.repeat(600));
  const bounded = speechChunks('Una frase más. '.repeat(300));
  assert.ok(bounded.join(' ').length <= 1500);
  assert.deepEqual(speechChunks('https://example.test'), []);
});
