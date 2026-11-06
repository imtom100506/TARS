const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServerActivity } = require('../src/serverActivity');
const { activityReply, duration } = require('../src/activityReply');

async function scenario() {
  let time = Date.parse('2026-11-05T21:18:00Z'), saved;
  const members = new Map(['1', '2', '3', '4'].map(id => [id, { displayName: `Persona ${id}`, user: { username: `user${id}`, bot: false } }]));
  const guild = { id: 'g', members: { cache: members }, channels: { cache: new Map([['voice', { name: 'Charla Chill 1' }], ['other', { name: 'Charla Chill 2' }]]) }, voiceStates: { cache: new Map() } };
  const state = (id, channelId) => ({ id, channelId, guild, member: members.get(id) });
  for (const id of members.keys()) guild.voiceStates.cache.set(id, state(id, 'voice'));
  const store = { read: async () => saved, write: async s => { saved = s; } };
  const tracker = createServerActivity({ store, now: () => time });
  await tracker.start([guild]);
  return { tracker, guild, state, store, advance: ms => { time += ms; }, now: () => time,
    context: q => tracker.context(guild, q, '1') };
}

test('screenshot regression: four existing sessions with 15 seconds each are partial person-time, not the full call', async () => {
  const f = await scenario(); f.advance(15000);
  await f.tracker.message({ guild: f.guild, author: { id: '1' } });
  await f.tracker.message({ guild: f.guild, author: { id: '1' } });
  const question = 'Me alegro. Como va la actividad del server';
  const context = await f.context(question);
  const data = JSON.parse(context.split('\n').at(-1));
  assert.equal(data.hoy.vozMs, 60000);
  assert.equal(data.hoy.topVoz[0].vozMs, 15000);
  assert.equal(data.hoy.topVoz[0].minutosVoz, 0.25);
  assert.equal(data.hoy.conexiones, 0);
  assert.equal(data.cobertura.sesionesActualesConInicioDesconocido, 4);
  const reply = activityReply(context, question, '1');
  assert.match(reply, /Hay 4 personas en Charla Chill 1/);
  assert.match(reply, /empatados/);
  assert.match(reply, /Persona 1 también ha estado participando/);
  assert.doesNotMatch(reply, /Registro parcial|2026|18:18| min|desconocid|tiempo-persona|Charla Chill 2/);
  const spoken = activityReply(context, question, '1', { voice: true });
  assert.ok(spoken.length <= 280);
  assert.match(spoken, /Hay 4 personas en Charla Chill 1/);
  assert.doesNotMatch(spoken, / min|registro parcial/i);
  assert.match(activityReply(await f.context('Quién está más activo en voz hoy'), 'Quién está más activo en voz hoy'), /empatados/);
});

test('rankings use the requested metric and detect genuine ties without inventing a text tie', async () => {
  const f = await scenario(); f.advance(10000);
  await f.tracker.message({ guild: f.guild, author: { id: '2' } });
  const voice = activityReply(await f.context('top voz hoy'), 'top voz hoy');
  const text = activityReply(await f.context('quién escribió más mensajes hoy'), 'quién escribió más mensajes hoy');
  assert.match(voice, /empatados/);
  assert.match(text, /Persona 2 es quien más ha escrito/);
  assert.doesNotMatch(text, /empate/);
});

test('18:26 request lists occupied channels and a genuine leader without dates, durations or boilerplate', async () => {
  const f = await scenario();
  f.advance(1000);
  for (const id of ['2', '3', '4']) await f.tracker.voice(f.state(id, 'voice'), f.state(id, null));
  f.advance(1000);
  for (const id of ['2', '3', '4', '5', '6', '7']) {
    if (!f.guild.members.cache.has(id)) f.guild.members.cache.set(id, { displayName: `Persona ${id}`, user: { bot: false } });
    const channel = ['6', '7'].includes(id) ? 'other' : 'voice';
    const state = f.state(id, channel);
    f.guild.voiceStates.cache.set(id, state);
    await f.tracker.voice(f.state(id, null), state);
  }
  f.advance(1000);
  const q = 'Hola, buenas tardes. Como va la actividad del server?';
  const reply = activityReply(await f.context(q), q, '1');
  assert.match(reply, /Hay 5 personas en Charla Chill 1/);
  assert.match(reply, /Hay 2 personas en Charla Chill 2/);
  assert.match(reply, /Persona 1 es quien más ha estado en voz/);
  assert.doesNotMatch(reply, /Registro|2026|parcial|minuto| min|sesiones|desconocido|período|tiempo-persona/);
});

test('occupancy uses all current states, not the ten-member preview, and excludes bots', async () => {
  const f = await scenario();
  for (let id = 5; id <= 13; id++) {
    f.guild.members.cache.set(String(id), { user: { bot: id === 13 } });
    f.guild.voiceStates.cache.set(String(id), f.state(String(id), 'voice'));
  }
  const data = JSON.parse((await f.context('actividad')).split('\n').at(-1));
  assert.equal(data.ahoraEnVoz, 12);
  assert.equal(data.canalesVoz[0].personas, 12);
  assert.equal(data.participantesActualesPrimeros10.length, 10);
});

test('long running sessions accrue beyond startup and current-call origin survives moves', async () => {
  const f = await scenario(); f.advance(2 * 3600000 + 47 * 60000 + 17000);
  await f.tracker.voice(f.state('1', 'voice'), f.state('1', 'other'));
  f.guild.voiceStates.cache.set('1', f.state('1', 'other'));
  const data = JSON.parse((await f.context('actividad')).split('\n').at(-1));
  assert.equal(data.hoy.topVoz[0].vozMs, 10037000);
  assert.equal(data.hoy.vozMs, 40148000);
  assert.equal(data.participantesActualesPrimeros10[0].observadoDesde, Date.parse('2026-11-05T21:18:00Z'));
  assert.equal(data.participantesActualesPrimeros10[0].inicioRealConocido, false);
});

test('restart keeps previous totals but never fabricates time while offline or a known session origin', async () => {
  const f = await scenario(); f.advance(15000); await f.tracker.flush();
  f.advance(3600000);
  const next = createServerActivity({ store: f.store, now: f.now });
  await next.start([f.guild]); f.advance(15000);
  const context = await next.context(f.guild, 'actividad');
  const data = JSON.parse(context.split('\n').at(-1));
  assert.equal(data.hoy.vozMs, 120000);
  assert.equal(data.cobertura.sesionesActualesConInicioDesconocido, 4);
  assert.match(activityReply(context, 'actividad'), /Hay 4 personas en Charla Chill 1/);
});

test('new observed connection has known origin, precise individual duration and no startup warning', async () => {
  const f = await scenario();
  for (const id of f.guild.members.cache.keys()) await f.tracker.voice(f.state(id, 'voice'), f.state(id, null));
  f.guild.voiceStates.cache.clear();
  await f.tracker.voice(f.state('1', null), f.state('1', 'voice'));
  f.guild.voiceStates.cache.set('1', f.state('1', 'voice')); f.advance(59999);
  const context = await f.context('cuánto tiempo he estado conectado hoy');
  const reply = activityReply(context, 'cuánto tiempo he estado conectado hoy', '1');
  assert.match(reply, /Persona 1: 1 conexiones observadas, 59 s/);
  assert.doesNotMatch(reply, /duración real es desconocida/);
});

test('formatting never rounds seconds up to minutes; unrelated conversation still uses AI', () => {
  assert.equal(duration(0), '0 s'); assert.equal(duration(300), 'menos de 1 s');
  assert.equal(duration(59999), '59 s'); assert.equal(duration(60000), '1 min');
  assert.equal(duration(10037000), '2 h 47 min 17 s');
  assert.equal(activityReply('anything', 'hola'), null);
  assert.equal(activityReply('anything', 'Buenos días TARS'), null);
  const error = 'Estadísticas de actividad no disponibles por un error del registro. No inventes cifras.';
  assert.equal(activityReply(error, 'cómo va la actividad'), error);
});

test('hourly replies name the period and reject unsupported minutes instead of using today', async () => {
  const f = await scenario(); f.advance(60000);
  const q = 'actividad hoy por hora';
  assert.match(activityReply(await f.context(q), q), /18:00: 0 mensajes; 4 min en voz/);
  const night = 'qué tal estuvo la actividad del server anoche';
  const reply = activityReply(await f.context(night), night);
  assert.match(reply, /Anoche, de 2026-11-04 20:00 a 2026-11-05 06:00/);
  assert.doesNotMatch(reply, /Ahora|hoy|4 min/);
  const invalid = 'actividad hoy de 18:15 a 19:30';
  assert.match(activityReply(await f.context(invalid), invalid), /horas completas/);
});

test('mi servidor asks for community activity while personal pronouns still select the requester', async () => {
  const f = await scenario(); f.advance(60000);
  await f.tracker.message({ guild: f.guild, author: { id: '1' } });
  const general = 'cómo va la actividad de mi servidor';
  const reply = activityReply(await f.context(general), general, '1');
  assert.match(reply, /Hay 4 personas en Charla Chill 1/);
  assert.doesNotMatch(reply, /He visto a Persona 1 conectarse/);
  const personal = 'cuántos mensajes he enviado hoy';
  assert.match(activityReply(await f.context(personal), personal, '1'), /Persona 1.*enviar 1 mensaje/);
  const durationQuestion = 'cuánto tiempo lleva la actividad de mi servidor hoy';
  assert.match(activityReply(await f.context(durationQuestion), durationQuestion, '1'), /Ahora hay 4 personas/);
});
