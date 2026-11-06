const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequestLimits } = require('../src/requestLimits');
test('per-user and per-guild sliding limits reject excess requests and recover without extending the window', () => {
  let at = 0; const allow = createRequestLimits({ now: () => at, userLimit: 2, guildLimit: 3 });
  assert.equal(allow('a', 'g'), true); assert.equal(allow('a', 'g'), true);
  assert.equal(allow('a', 'other'), false); assert.equal(allow('b', 'g'), true); assert.equal(allow('c', 'g'), false);
  at = 59000; assert.equal(allow('a', 'g'), false);
  at = 60000; assert.equal(allow('a', 'g'), true); assert.equal(allow('c', 'g'), true);
});
