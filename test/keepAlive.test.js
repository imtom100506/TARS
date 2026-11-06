const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const keepAlive = require("../src/keepAlive");

test("native HTTP health endpoint supports GET/HEAD and rejects other paths", async t => {
  const server = keepAlive(0);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(url + "/?health=1");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "TARS activo");
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(url + "/missing")).status, 404);
  assert.equal((await fetch(url, { method: "POST" })).status, 404);
});

test('readiness fails closed until dependencies recover, while liveness stays available', async t => {
  let ready = false;
  const server = keepAlive(0, { ready: () => { if (ready === 'error') throw Error('storage'); return ready; } });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/ready')).status, 503);
  assert.equal((await fetch(url + '/live')).status, 200);
  ready = true; const ok = await fetch(url + '/ready');
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store');
  ready = 'error'; assert.equal((await fetch(url + '/ready')).status, 503);
  ready = false; assert.equal((await fetch(url + '/ready', { method: 'HEAD' })).status, 503);
});
