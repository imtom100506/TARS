const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createFileStore } = require('../src/fileStore');
const { createUsageBudget } = require('../src/usageBudget');
test('file quota persists across instances, serializes writes and validates storage without spending quota', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-file-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'quota.json'), store = createFileStore(file);
  assert.equal(await store.read(), null);
  const budget = createUsageBudget({ store, now: () => 1000, minuteRequests: 1 });
  await budget.check(); assert.equal(await store.read(), '[]');
  await budget.reserve({ tokens: 10 });
  const restored = createUsageBudget({ store: createFileStore(file), now: () => 1000, minuteRequests: 1 });
  await restored.check(); await assert.rejects(restored.reserve(), e => e.code === 'AI_BUDGET');
  await Promise.all([store.write('first'), store.write('second')]);
  assert.equal(await createFileStore(file).read(), 'second');
});
test('quota readiness never overwrites corrupt state and recovers from temporary write failures', async () => {
  let saved = 'corrupt', fail = false, writes = 0;
  const store = { read: async () => saved, write: async text => { if (fail) throw Error('disk full'); writes++; saved = text; } };
  const budget = createUsageBudget({ store });
  await assert.rejects(budget.check()); assert.equal(writes, 0); assert.equal(saved, 'corrupt');
  saved = '[]'; fail = true; await assert.rejects(budget.check(), /disk full/);
  fail = false; await budget.check(); assert.equal(saved, '[]'); assert.equal(writes, 1);
});
