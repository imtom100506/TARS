const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServerActivity, day, period } = require('../src/serverActivity');

function fixture(raw = null) {
  let time = Date.parse('2026-11-05T15:00:00Z');
  const store = { read: async () => raw, write: async value => { raw = value; } };
  const tracker = createServerActivity({ store, now: () => time });
  const g = { id: 'g', voiceStates: { cache: new Map() }, members: { cache: new Map([
    ['u', { displayName: 'Tom', user: { username: 'tom' } }], ['v', { displayName: 'Ana', user: { username: 'ana' } }],
  ]) } };
  const state = (channelId, id = 'u', bot = false) => ({ guild: g, id, channelId, member: { user: { bot } } });
  const stats = async (question = '', guild = g) => JSON.parse((await tracker.context(guild, question)).split('\n').at(-1));
  return { tracker, g, state, stats, raw: () => raw, set: value => { time = Date.parse(value); }, advance: ms => { time += ms; } };
}

test('counts human connections, distinct people, live duration and messages; moves and mute changes do not inflate joins', async () => {
  const f = fixture();
  await f.tracker.start([f.g]);
  await f.tracker.voice(f.state(null), f.state('a'));
  f.advance(60000);
  await f.tracker.voice(f.state('a'), f.state('b'));
  await f.tracker.voice(f.state('b'), f.state('b'));
  await f.tracker.voice(f.state(null, 'bot', true), f.state('a', 'bot', true));
  f.advance(60000);
  await f.tracker.voice(f.state('b'), f.state(null));
  await f.tracker.voice(f.state(null), f.state('a'));
  await f.tracker.voice(f.state(null, 'v'), f.state('a', 'v'));
  f.advance(60000);
  await f.tracker.message({ guild: f.g, author: { id: 'u' }, attachments: { size: 2 } });
  await f.tracker.message({ guild: f.g, author: { id: 'bot', bot: true } });
  await f.tracker.member({ guild: f.g, user: { bot: false } }, true);
  const { hoy } = await f.stats();
  assert.equal(hoy.conexiones, 3);
  assert.equal(hoy.usuariosVoz, 2);
  assert.equal(hoy.minutosVoz, 4);
  assert.equal(hoy.topVoz[0].usuario, 'Tom');
  assert.equal(hoy.mensajes, 1);
  assert.equal(hoy.adjuntos, 2);
  assert.equal(hoy.ingresos, 1);
  assert.deepEqual((await f.stats()).hoy, hoy, 'reading twice must not double count');
});

test('splits sessions at Chilean midnight and retains historical daily results', async () => {
  const f = fixture();
  f.set('2026-11-06T02:59:00Z');
  await f.tracker.voice(f.state(null), f.state('a'));
  f.advance(120000);
  const { hoy, periodoConsultado: yesterday } = await f.stats('ayer por dia');
  assert.equal(hoy.conexiones, 0); assert.equal(hoy.usuariosVoz, 1); assert.equal(hoy.minutosVoz, 1);
  assert.equal(yesterday.conexiones, 1); assert.equal(yesterday.minutosVoz, 1);
  assert.equal((await f.stats('historico')).periodoConsultado.minutosVoz, 2);
  assert.equal(day(Date.parse('2026-11-06T02:59:00Z')), '2026-11-05');
});

test('restart preserves totals and seeds current sessions without inventing connections or downtime', async () => {
  const f = fixture();
  await f.tracker.voice(f.state(null), f.state('a'));
  f.advance(60000); await f.tracker.flush();
  const next = fixture(f.raw());
  next.set('2026-11-06T15:00:00Z');
  next.g.voiceStates.cache.set('u', next.state('a'));
  await next.tracker.start([next.g]);
  next.advance(60000);
  const stats = await next.stats('historico');
  assert.equal(stats.ahoraEnVoz, 1);
  assert.equal(stats.hoy.conexiones, 0);
  assert.equal(stats.periodoConsultado.conexiones, 1);
  assert.equal(stats.periodoConsultado.minutosVoz, 2);
});

test('gateway downtime is excluded and servers remain isolated', async () => {
  const f = fixture();
  await f.tracker.voice(f.state(null), f.state('a'));
  f.advance(60000); await f.tracker.pause(['g']);
  f.advance(3600000);
  f.g.voiceStates.cache.set('u', f.state('a'));
  await f.tracker.sync(f.g);
  f.advance(60000);
  assert.equal((await f.stats()).hoy.minutosVoz, 2);
  const other = { ...f.g, id: 'other', voiceStates: { cache: new Map() } };
  assert.equal((await f.stats('', other)).hoy.conexiones, 0);
});

test('failed reads never overwrite historical data and failed writes can retry', async () => {
  let writes = 0;
  const broken = createServerActivity({ store: { read: async () => '{broken', write: async () => writes++ } });
  await assert.rejects(broken.flush()); assert.equal(writes, 0);
  let fail = true;
  const tracker = createServerActivity({ store: { read: async () => null, write: async () => { if (fail) throw Error('offline'); writes++; } } });
  await assert.rejects(tracker.flush()); fail = false; await tracker.flush(); assert.equal(writes, 1);
});

test('period selection supports history, relative days and explicit inclusive ranges', () => {
  assert.deepEqual(period('histórico', '2026-11-05'), ['0000-01-01', '2026-11-05']);
  assert.deepEqual(period('últimos 7 días', '2026-11-05'), ['2026-10-30', '2026-11-05']);
  assert.deepEqual(period('entre 2026-10-01 y 2026-10-31', '2026-11-05'), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(period('cuántos se han conectado hoy', '2026-11-05'), ['2026-11-05', '2026-11-05']);
  assert.deepEqual(period('mes pasado', '2026-11-05'), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(period('semana pasada', '2026-11-05'), ['2026-10-26', '2026-11-01']);
  assert.throws(() => period('2026-02-30', '2026-11-05'));
  assert.throws(() => period('2026-11-05 a 2026-11-01', '2026-11-05'));
});
