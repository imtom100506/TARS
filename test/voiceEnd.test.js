const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServerActivity } = require('../src/serverActivity');
const { createServerAudit, auditRequested } = require('../src/serverAudit');
const { isActivityQuestion } = require('../src/activityQuery');
const { activityReply } = require('../src/activityReply');

test('screenshot wording reads persisted voice events at Chile time, excluding bots and private channels', async () => {
  let time = Date.parse('2026-11-09T23:30:00Z'), saved;
  const store = { read: async () => saved, write: async value => { saved = value; } };
  const tracker = createServerActivity({ store, now: () => time });
  const audit = createServerAudit({ activity: tracker, now: () => time });
  const guild = { id: 'g', channels: { cache: new Map([['public', { id: 'public' }], ['private', { id: 'private' }]]) },
    members: { cache: new Map() }, voiceStates: { cache: new Map() } };
  const state = (channelId, bot = false) => ({ id: '123', channelId, guild, member: { user: { bot } } });
  await audit.voice(state(null), state('public'));
  time = Date.parse('2026-11-10T05:42:00Z');
  await audit.voice(state('public'), state(null));
  time += 60000;
  await audit.voice(state('public', true), state(null, true));
  time += 60000;
  await audit.voice(state('private'), state(null));
  await tracker.flush();
  time = Date.parse('2026-11-10T16:00:00Z');
  const restored = createServerActivity({ store, now: () => time });
  for (const question of ['hasta que hora se quedaron anoche aprox?', 'a qué hora se desconectaron de voz anoche']) {
    assert.equal(isActivityQuestion(question), true);
    assert.equal(auditRequested(question), false);
    const context = await restored.context(guild, question, 'reader', { canViewChannel: c => c.id === 'public' });
    const reply = activityReply(context, question);
    assert.match(reply, /02:42/);
    assert.match(reply, /última salida/);
    assert.match(reply, /20:00.*06:00/);
    assert.doesNotMatch(reply, /02:43|02:44|sumando personas/);
  }
  const empty = createServerActivity({ store: { read: async () => null }, now: () => time });
  const q = 'hasta qué hora se quedaron anoche';
  assert.match(activityReply(await empty.context(guild, q), q), /No encontré eventos/);
});
