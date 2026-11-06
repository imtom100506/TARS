const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDiscordMuteStore, MARKER } = require("../src/muteStore");

test("Discord state survives process restart and ignores other authors' fake records", async () => {
  const messages = new Map([["fake", { id: "fake", author: { id: "someone" }, content: MARKER }]]);
  let body, sends = 0, edits = 0;
  const channel = { isTextBased: () => true, messages: { fetch: async () => messages },
    async send(payload) {
      sends++;
      body = payload.files[0].attachment.toString("utf8");
      const message = { id: "real", author: { id: "bot" }, content: payload.content,
        attachments: new Map([["file", { name: "tars-text-mutes.json", url: "https://example.test/state" }]]),
        async edit(next) { edits++; body = next.files[0].attachment.toString("utf8"); return this; },
      };
      messages.set("real", message);
      return message;
    },
  };
  const client = { user: { id: "bot" }, channels: { fetch: async () => channel } };
  const download = async () => ({ ok: true, text: async () => body });
  const store = createDiscordMuteStore(client, "logs", download);
  assert.equal(await store.read(), null);
  await store.write('{"version":1,"records":[]}');
  await store.write('{"version":1,"records":[{"userId":"u"}]}');
  await store.write('{"version":1,"records":[{"userId":"u"}]}');
  const restarted = createDiscordMuteStore(client, "logs", download);
  assert.equal(await restarted.read(), body);
  await restarted.write('{"version":1,"records":[]}');
  assert.equal(sends, 1);
  assert.equal(edits, 2);
  const failing = createDiscordMuteStore(client, "logs", async () => ({ ok: false }));
  await assert.rejects(failing.read());
});

function deletionFixture() {
  const messages = new Map();
  let sends = 0, body = '', failDownload = false, failLookup = false;
  const missing = () => Object.assign(new Error('Unknown Message'), { code: 10008 });
  const channel = { isTextBased: () => true,
    messages: { async fetch(options) {
      if (failLookup) throw new Error('offline');
      if (options.message) {
        if (!messages.has(options.message)) throw missing();
        return messages.get(options.message);
      }
      return messages;
    } },
    async send(payload) {
      const id = String(++sends);
      body = payload.files[0].attachment.toString('utf8');
      const message = { id, author: { id: 'bot' }, content: MARKER,
        attachments: new Map([['f', { name: 'tars-text-mutes.json', url: 'https://example.test/state' }]]),
        async edit(next) {
          if (!messages.has(id)) throw missing();
          body = next.files[0].attachment.toString('utf8');
          return message;
        } };
      messages.set(id, message); return message;
    } };
  const client = { user: { id: 'bot' }, channels: { fetch: async () => channel } };
  const download = async () => ({ ok: !failDownload, text: async () => body });
  return { store: createDiscordMuteStore(client, 'state', download),
    restart: () => createDiscordMuteStore(client, 'state', download), messages,
    body: () => body, sends: () => sends, failDownload: value => { failDownload = value; },
    failLookup: value => { failLookup = value; } };
}

test('deleted state is recreated from loaded current data for both changed and unchanged writes', async () => {
  for (const changed of [false, true]) {
    const f = deletionFixture();
    await f.store.read(); await f.store.write('{"records":["old"]}');
    const restarted = f.restart();
    assert.equal(await restarted.read(), '{"records":["old"]}');
    f.messages.clear();
    const current = changed ? '{"records":["old","new"]}' : '{"records":["old"]}';
    await restarted.write(current);
    assert.equal(f.sends(), 2);
    assert.equal(f.body(), current);
    assert.equal(await f.restart().read(), current);
  }
});

test('failed reads or failed recovery lookups never create empty replacement records', async () => {
  const f = deletionFixture();
  await assert.rejects(f.store.write('{}'), /leerse correctamente/);
  await f.store.read(); await f.store.write('{"records":["safe"]}');
  f.failDownload(true);
  const restarted = f.restart();
  await assert.rejects(restarted.read());
  await assert.rejects(restarted.write('{}'), /leerse correctamente/);
  assert.equal(f.body(), '{"records":["safe"]}');
  f.messages.clear(); f.failLookup(true);
  await assert.rejects(f.store.write('{"records":["safe","current"]}'), /offline/);
  assert.equal(f.sends(), 1);
  f.failLookup(false);
  await f.store.write('{"records":["safe","current"]}');
  assert.equal(f.sends(), 2);
});

test('a replacement from another instance must be read before it can be overwritten', async () => {
  const f = deletionFixture();
  await f.store.read(); await f.store.write('{"records":["old"]}');
  f.messages.clear();
  const other = f.restart();
  await other.read(); await other.write('{"records":["newer"]}');
  await assert.rejects(f.store.write('{"records":[]}'), /fue reemplazado/);
  await assert.rejects(f.store.write('{"records":[]}'), /leerse correctamente/);
  assert.equal(f.body(), '{"records":["newer"]}');
  assert.equal(f.sends(), 2);
  assert.equal(await f.store.read(), '{"records":["newer"]}');
  await f.store.write('{"records":["newer","merged"]}');
  assert.equal(f.body(), '{"records":["newer","merged"]}');
});
