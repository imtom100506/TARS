const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, AuditLogEvent: A } = require('discord.js');
const { createServerActivity } = require('../src/serverActivity');
const { createServerAudit, auditRequested } = require('../src/serverAudit');
function fixture({ allowed = true, maxPages = 10 } = {}) {
  const at = Date.parse('2026-11-05T21:00:00Z');
  let saved, entries = new Collection(), calls = 0, fail = false;
  const store = { read: async () => saved, write: async s => { saved = s; } };
  const activity = createServerActivity({ store, now: () => at });
  const g = { id: 'g', members: { me: { permissions: { has: () => allowed } }, cache: new Map([
    ['1', { displayName: 'Tom' }], ['2', { displayName: 'Ana' }],
  ]) }, channels: { cache: new Map([['c1', { name: 'Charla Chill 1' }], ['c2', { name: 'Charla Chill 2' }]]) },
    fetchAuditLogs: async () => { calls++; if (fail) throw Error('network'); return { entries }; } };
  const audit = createServerAudit({ activity, now: () => at, maxPages });
  const entry = (id, action, extra = {}) => ({ id, action, createdTimestamp: at, executorId: '1', targetId: '2', changes: [], ...extra });
  return { audit, activity, g, entry, store, set: rows => { entries = new Collection(rows.map(e => [e.id, e])); }, fail: () => { fail = true; }, get calls() { return calls; }, at };
}
test('audit intent detection distinguishes read-only questions from commands and help', () => {
  for (const text of ['quién hizo kick a <@2>', 'quién muteó a Ana', 'resume la auditoría', 'quién movió a Ana', 'quién entró al canal', 'quién puso timeout a Ana', 'quién se conectó al canal']) assert.ok(auditRequested(text), text);
  for (const text of ['mutea a <@2> por 10 minutos', 'saca a <@2>', 'qué comandos tienes para mutear', 'cómo va la actividad del servidor']) assert.equal(auditRequested(text), false, text);
});
test('REST audit identifies executors for bans, kicks, mute, deafen and timeout', async () => {
  const f = fixture();
  f.set([f.entry('1', A.MemberBanAdd), f.entry('2', A.MemberKick), f.entry('3', A.MemberUpdate, { changes: [{ key: 'mute', new: true }, { key: 'deaf', new: true }, { key: 'communication_disabled_until', new: '2026-11-06T00:00:00Z' }] })]);
  const result = await f.audit.reply(f.g, 'muestra la auditoría');
  assert.match(result, /Tom baneó a Ana/); assert.match(result, /Tom expulsó a Ana/);
  assert.match(result, /Tom activó el silencio/); assert.match(result, /Tom activó el ensordecimiento/); assert.match(result, /timeout a Ana/);
});
test('merged move entries are refreshed/upserted, never attributed to a target Discord did not identify', async () => {
  const f = fixture();
  f.set([f.entry('1', A.MemberMove, { targetId: null, extra: { channel: { id: 'c2' }, count: 1 } })]);
  await f.audit.reply(f.g, 'quién movió a Ana');
  f.set([f.entry('1', A.MemberMove, { targetId: null, extra: { channel: { id: 'c2' }, count: 3 } })]);
  const answer = await f.audit.reply(f.g, 'quién movió a Ana');
  assert.match(answer, /Tom movió a 3 miembro\(s\) a Charla Chill 2/);
  assert.match(answer, /Discord no identifica/); assert.doesNotMatch(answer, /Tom movió a Ana/);
  assert.equal((await f.activity.events('g')).length, 1);
  assert.equal(f.calls, 2);
});
test('voice joins/leaves/moves and self/server mute changes are independent of audit actors', async () => {
  const f = fixture();
  const state = (channelId, extra = {}) => ({ id: '2', guild: f.g, channelId, selfMute: false, serverMute: false, selfDeaf: false, serverDeaf: false, ...extra });
  await f.audit.voice(state(null), state('c1'));
  await f.audit.voice(state('c1'), state('c2'));
  await f.audit.voice(state('c2'), state('c2', { selfMute: true, serverDeaf: true }));
  await f.audit.voice(state('c2'), state(null));
  const reply = await f.audit.reply(f.g, 'muestra auditoría');
  assert.match(reply, /Ana entró a Charla Chill 1/); assert.match(reply, /Ana salió de Charla Chill 2/);
  assert.match(reply, /no indica quién lo movió/); assert.match(reply, /silencio propio/);
  assert.match(reply, /autor no identificado/); assert.doesNotMatch(reply, /Tom/);
  await f.activity.flush();
  const restored = createServerActivity({ store: f.store });
  assert.equal((await restored.events('g')).length, 5);
  assert.deepEqual(await restored.events('other'), []);
});
test('missing permission and REST failure are explicit without inventing empty audit history', async () => {
  const denied = fixture({ allowed: false });
  assert.match(await denied.audit.reply(denied.g, 'auditoría'), /Me falta el permiso Ver registro de auditoría/);
  assert.equal(denied.calls, 0);
  const f = fixture(); await f.audit.record(f.entry('1', A.MemberKick), f.g); f.fail();
  const reply = await f.audit.reply(f.g, 'quién hizo kick');
  assert.match(reply, /No pude actualizar/); assert.match(reply, /Tom expulsó a Ana/);
});
test('bounded pagination discloses incomplete coverage and read-only requests remain guild scoped', async () => {
  const f = fixture({ maxPages: 1 });
  f.set(Array.from({ length: 100 }, (_, i) => f.entry(String(i), A.MemberBanAdd)));
  assert.match(await f.audit.reply(f.g, 'muestra baneos'), /puede haber más acciones antiguas/);
  assert.equal((await f.activity.events('g')).length, 100);
  assert.equal(await f.audit.reply(f.g, 'hola'), null);
  assert.match(await f.audit.reply(null, 'auditoría'), /dentro del servidor/);
});
