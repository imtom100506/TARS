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

test('hourly counters split sessions and select last night rather than today', async () => {
  const f = fixture();
  f.set('2026-11-06T02:30:00Z'); // Nov 5, 23:30 Chile
  await f.tracker.voice(f.state(null), f.state('a'));
  await f.tracker.message({ guild: f.g, author: { id: 'u' } });
  f.advance(3600000);
  await f.tracker.voice(f.state('a'), f.state(null));
  f.set('2026-11-06T15:00:00Z');
  await f.tracker.message({ guild: f.g, author: { id: 'v' } });
  const stats = await f.stats('actividad anoche por hora');
  assert.equal(stats.periodoConsultado.mensajes, 1);
  assert.equal(stats.periodoConsultado.vozMs, 3600000);
  assert.deepEqual(stats.periodoConsultado.horas.map(r => r.vozMs), [1800000, 1800000]);
  assert.equal(stats.hoy.mensajes, 1);
  const range = await f.stats('actividad ayer de 23 a 24');
  assert.equal(range.periodoConsultado.vozMs, 1800000);
  assert.equal(range.periodoConsultado.conexiones, 1);
  await f.tracker.flush();
  const next = fixture(f.raw()); next.set('2026-11-06T15:00:00Z');
  assert.equal((await next.stats('actividad anoche')).periodoConsultado.vozMs, 3600000);
});

test('legacy daily totals are preserved but never invented as hourly history', async () => {
  const f = fixture();
  await f.tracker.message({ guild: f.g, author: { id: 'u' } }); await f.tracker.flush();
  const legacy = JSON.parse(f.raw()); delete legacy.guilds.g.hours; delete legacy.guilds.g.hourlySince;
  const next = fixture(JSON.stringify(legacy)); next.advance(3600000);
  const stats = await next.stats('actividad hoy por hora');
  assert.equal(stats.hoy.mensajes, 1);
  assert.equal(stats.periodoConsultado.mensajes, 0);
  assert.equal(stats.consultaHoraria.parcial, true);
});

test('repeated Chilean DST hour has separate buckets without lost or doubled voice time', async () => {
  const f = fixture(); f.set('2026-04-05T02:30:00Z');
  await f.tracker.voice(f.state(null), f.state('a')); f.advance(3600000);
  const stats = await f.stats('actividad 2026-04-04 por hora');
  assert.equal(stats.periodoConsultado.vozMs, 3600000);
  assert.equal(stats.periodoConsultado.horas.length, 2);
  assert.notEqual(stats.periodoConsultado.horas[0].inicioUTC, stats.periodoConsultado.horas[1].inicioUTC);
});

test('unrecognized explicit periods ask for clarification instead of silently reporting today', () => {
  for (const question of ['actividad lunes pasado', 'actividad hace 3 días', 'actividad hace una hora',
    'actividad a las seis', 'actividad el año pasado', 'actividad el 05/10/2026', 'actividad últimos cero días',
    'actividad hoy hace una hora', 'actividad histórica hace una hora', 'actividad en la última hora']) {
    assert.throws(() => period(question, '2026-11-05'), { code: 'ACTIVITY_PERIOD' }, question);
  }
  assert.deepEqual(period('Buenos días, cómo va la actividad', '2026-11-05'), ['2026-11-05', '2026-11-05']);
  assert.deepEqual(period('actividad histórica por hora', '2026-11-05'), ['0000-01-01', '2026-11-05']);
});

test('channel-scoped history excludes private, deleted and legacy data while preserving visible rankings', async () => {
  const f = fixture();
  f.g.channels = { cache: new Map([['a', { id: 'a', name: 'Público' }], ['secret', { id: 'secret', name: 'Privado' }]]) };
  await f.tracker.voice(f.state(null), f.state('a'));
  await f.tracker.voice(f.state(null, 'v'), f.state('secret', 'v'));
  f.g.voiceStates.cache.set('u', f.state('a'));
  f.g.voiceStates.cache.set('v', f.state('secret', 'v'));
  f.advance(60000);
  await f.tracker.voice(f.state('a'), f.state('secret'));
  f.g.voiceStates.cache.set('u', f.state('secret'));
  f.advance(120000);
  for (const [id, channelId] of [['u', 'a'], ['v', 'secret'], ['v', 'deleted'], ['v', null]]) {
    await f.tracker.message({ guild: f.g, author: { id }, channelId });
  }
  const context = await f.tracker.context(f.g, 'actividad hoy por hora', 'u', { canViewChannel: c => c.id === 'a' });
  const stats = JSON.parse(context.split('\n').at(-1));
  assert.equal(stats.scopedHistory, true);
  assert.equal(stats.ahoraEnVoz, 0);
  assert.deepEqual(stats.canalesVoz, []);
  assert.equal(stats.hoy.usuariosVoz, 1);
  assert.equal(stats.hoy.vozMs, 60000);
  assert.equal(stats.hoy.conexiones, 1);
  assert.equal(stats.hoy.mensajes, 1);
  assert.equal(stats.hoy.topVoz[0].usuario, 'Tom');
  assert.equal(stats.periodoConsultado.horas[0].vozMs, 60000);
  assert.equal(stats.periodoConsultado.horas[0].mensajes, 1);
  assert.doesNotMatch(context, /Privado|secret|deleted|Ana/);
  assert.equal((await f.stats()).hoy.mensajes, 4, 'full trusted totals remain available without a channel filter');
});

test('old aggregate history is never attributed to public channels during migration', async () => {
  const old = fixture();
  await old.tracker.message({ guild: old.g, author: { id: 'v' } });
  await old.tracker.flush();
  const next = fixture(old.raw());
  const data = JSON.parse((await next.tracker.context(next.g, 'actividad', 'u', { canViewChannel: () => true })).split('\n').at(-1));
  assert.equal(data.hoy.mensajes, 0);
  assert.deepEqual(data.hoy.topTexto, []);
  assert.equal((await next.stats()).hoy.mensajes, 1);
});

test('event and daily/hourly retention apply to loads, reads and flushes without new events', async () => {
  const original = fixture();
  original.set('2025-11-05T15:00:00Z');
  await original.tracker.message({ guild: original.g, author: { id: 'u' }, channelId: 'a' });
  await original.tracker.recordEvent('g', { id: 'old', at: Date.parse('2025-11-05T15:00:00Z') });
  await original.tracker.flush();
  const next = fixture(original.raw());
  assert.deepEqual(await next.tracker.events('g'), []);
  assert.equal((await next.stats('histórico')).periodoConsultado.mensajes, 0);
  await next.tracker.flush();
  const saved = JSON.parse(next.raw()).guilds.g;
  assert.deepEqual(saved.days, {});
  assert.deepEqual(saved.hours, {});
  await next.tracker.recordEvent('g', { id: 'recent', at: Date.parse('2026-11-05T15:00:00Z') });
  next.advance(46 * 86400000);
  assert.deepEqual(await next.tracker.events('g'), []);
  await next.tracker.flush();
  assert.deepEqual(JSON.parse(next.raw()).guilds.g.events, []);
});

test('daily retention keeps inclusive cutoff, bounds hourly history and rejects invalid configuration', async () => {
  let raw;
  let time = Date.parse('2026-11-03T15:00:00Z');
  const tracker = createServerActivity({ now: () => time, dailyRetentionDays: 2,
    store: { read: async () => null, write: async value => { raw = value; } } });
  const g = { id: 'g', voiceStates: { cache: new Map() }, members: { cache: new Map() } };
  const message = () => tracker.message({ guild: g, author: { id: 'u' }, channelId: 'a' });
  await message(); time += 86400000; await message(); time += 86400000; await message();
  await tracker.flush();
  assert.deepEqual(Object.keys(JSON.parse(raw).guilds.g.days), ['2026-11-04', '2026-11-05']);
  assert.equal(Object.keys(JSON.parse(raw).guilds.g.hours).length, 2);
  const data = JSON.parse((await tracker.context(g, 'histórico')).split('\n').at(-1));
  assert.equal(data.periodoConsultado.mensajes, 2);
  assert.equal(data.cobertura.historicoDisponibleDesde, '2026-11-04');
  for (const days of [0, -1, 1.5, 3651, NaN]) assert.throws(() => createServerActivity({ dailyRetentionDays: days }));
});
