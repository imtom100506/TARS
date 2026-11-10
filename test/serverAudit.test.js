const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, AuditLogEvent: A } = require('discord.js');
const { createServerActivity } = require('../src/serverActivity');
const { createServerAudit, auditRequested } = require('../src/serverAudit');
function fixture({ allowed = true, requesterAllowed = true, maxPages = 10 } = {}) {
  let at = Date.parse('2026-11-05T21:00:00Z');
  let saved, entries = new Collection(), calls = 0, fail = false;
  const store = { read: async () => saved, write: async s => { saved = s; } };
  const activity = createServerActivity({ store, now: () => at });
  const g = { id: 'g', roles: { fetch: async () => new Collection() }, members: { fetchMe: async () => ({ permissions: { has: () => allowed } }), fetch: async request => { assert.equal(request.force, true); return { permissions: { has: () => requesterAllowed } }; }, cache: new Map([
    ['1', { displayName: 'Tom' }], ['2', { displayName: 'Ana' }],
  ]) }, channels: { cache: new Map([['c1', { name: 'Charla Chill 1' }], ['c2', { name: 'Charla Chill 2' }]]) },
    fetchAuditLogs: async () => { calls++; if (fail) throw Error('network'); return { entries }; } };
  const audit = createServerAudit({ activity, now: () => at, maxPages });
  const entry = (id, action, extra = {}) => ({ id, action, createdTimestamp: at, executorId: '1', targetId: '2', changes: [], ...extra });
  const reply = audit.reply;
  audit.reply = (guild, question, options = { requesterId: '1' }) => reply(guild, question, options);
  return { advance: ms => { at += ms; }, revoke: () => { requesterAllowed = false; }, audit, activity, g, entry, store, set: rows => { entries = new Collection(rows.map(e => [e.id, e])); }, fail: () => { fail = true; }, get calls() { return calls; }, at };
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
  f.advance(30000);
  f.set([f.entry('1', A.MemberMove, { targetId: null, extra: { channel: { id: 'c2' }, count: 3 } })]);
  const answer = await f.audit.reply(f.g, 'quién movió a Ana');
  assert.match(answer, /Tom movió a 3 miembro\(s\) a Charla Chill 2/);
  assert.match(answer, /Discord no identifica/); assert.doesNotMatch(answer, /Tom movió a Ana/);
  assert.equal((await f.activity.events('g')).length, 1);
  assert.equal(f.calls, 2);
});
test('voice joins/leaves/moves and self/server mute changes are independent of audit actors', async () => {
  const f = fixture();
  const state = (channelId, extra = {}) => ({ id: '2', guild: f.g, member: { user: { bot: false } }, channelId, selfMute: false, serverMute: false, selfDeaf: false, serverDeaf: false, ...extra });
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

test('audit access requires fresh requester permissions, including cached records', async () => {
  const f = fixture({ requesterAllowed: false });
  await f.audit.record(f.entry('1', A.MemberBanAdd), f.g);
  assert.match(await f.audit.reply(f.g, 'auditoría'), /Necesitas el permiso/);
  assert.match(await f.audit.reply(f.g, 'auditoría', {}), /Necesitas el permiso/);
  assert.equal(f.calls, 0);
  const allowed = fixture();
  allowed.set([allowed.entry('1', A.MemberKick)]);
  assert.match(await allowed.audit.reply(allowed.g, 'auditoría'), /expulsó/);
  allowed.revoke(); allowed.advance(10000);
  assert.match(await allowed.audit.reply(allowed.g, 'auditoría'), /Necesitas el permiso/);
  assert.equal(allowed.calls, 1);
});


test('unsupported audit dates and hourly requests never silently search another period', async () => {
  for (const question of ['auditoría del lunes pasado', 'auditoría de octubre', 'auditoría de hace tres días']) {
    const f = fixture();
    assert.match(await f.audit.reply(f.g, question), /período|fechas/);
    assert.equal(f.calls, 0);
  }
  for (const question of ['auditoría anoche', 'auditoría ayer de 18 a 20', 'auditoría por hora']) {
    const f = fixture();
    assert.match(await f.audit.reply(f.g, question), /no filtro.*por horas/);
    assert.equal(f.calls, 0);
  }
});

test('request cooldown and refresh cache bound repeated queries independently', async () => {
  const f = fixture(); f.set([f.entry('1', A.MemberKick)]);
  await f.audit.reply(f.g, 'auditoría');
  assert.match(await f.audit.reply(f.g, 'auditoría'), /Espera unos segundos/);
  await f.audit.reply(f.g, 'auditoría', { requesterId: '2' });
  assert.equal(f.calls, 1);
  f.advance(10000);
  assert.match(await f.audit.reply(f.g, 'auditoría'), /Tom expulsó/);
  assert.equal(f.calls, 1);
  f.advance(20000); await f.audit.reply(f.g, 'auditoría');
  assert.equal(f.calls, 2);
});

test('cached REST failure is retried after expiry without retaining a stale warning', async () => {
  const f = fixture();
  let requests = 0;
  f.g.fetchAuditLogs = async () => {
    requests++;
    if (requests === 1) throw new Error('offline');
    return { entries: new Collection([['9', f.entry('9', A.MemberKick)]]) };
  };
  assert.match(await f.audit.reply(f.g, 'auditoría'), /No pude actualizar/);
  f.advance(10000);
  assert.match(await f.audit.reply(f.g, 'auditoría'), /No pude actualizar/);
  assert.equal(requests, 1);
  f.advance(20000);
  const answer = await f.audit.reply(f.g, 'auditoría');
  assert.match(answer, /Tom expulsó/); assert.doesNotMatch(answer, /No pude actualizar/);
  assert.equal(requests, 2);
});

test('incremental refresh rereads the newest page and stops at the saved cursor', async () => {
  const f = fixture();
  let requests = 0, pages = [];
  const rows = (start, count) => new Collection(Array.from({ length: count }, (_, i) => {
    const id = String(start - i); return [id, f.entry(id, A.MemberBanAdd)];
  }));
  pages = [rows(250, 100), rows(150, 100), rows(50, 50)];
  f.g.fetchAuditLogs = async () => ({ entries: pages[requests++] });
  await f.audit.reply(f.g, 'auditoría');
  assert.equal(requests, 3);
  pages.push(rows(260, 100));
  f.advance(30000); await f.audit.reply(f.g, 'auditoría');
  assert.equal(requests, 4);
  assert.equal((await f.activity.events('g')).length, 260);
});

test('parallel guild refreshes are single flight with a bounded in-flight count', async () => {
  const f = fixture(); let unblock;
  const wait = new Promise(resolve => { unblock = resolve; });
  let requests = 0;
  f.g.fetchAuditLogs = async () => { requests++; await wait; return { entries: new Collection() }; };
  const pending = Array.from({ length: 8 }, (_, i) => f.audit.refresh({ ...f.g, id: `g${i}` }));
  const repeated = f.audit.refresh({ ...f.g, id: 'g0' });
  assert.match(await f.audit.refresh({ ...f.g, id: 'overflow' }), /otros registros/);
  unblock(); await Promise.all([...pending, repeated]);
  assert.equal(requests, 8);
});
