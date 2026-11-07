const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServerMembers, isMemberCountQuestion } = require('../src/serverMembers');

function fixture() {
  const members = new Map(['online', 'idle', 'dnd', 'offline', undefined].map((status, id) =>
    [id, { user: { bot: false }, presence: status ? { status } : undefined }]));
  members.set('bot', { user: { bot: true }, presence: { status: 'online' } });
  const guild = { name: 'Test', memberCount: 6, members: { fetch: async options => {
    assert.equal(options.withPresences, true);
    return members;
  } } };
  return { guild, members };
}

test('counts all humans, excludes bots from every presence count, and explains invisible status', async () => {
  const { guild } = fixture();
  const service = createServerMembers();
  assert.deepEqual(await service.read(guild), { humans: 5, bots: 1, online: 1, idle: 1, dnd: 1, offline: 2 });
  assert.match(await service.reply(guild), /3 conectadas/);
  assert.match(await service.reply(guild), /2 desconectadas o invisibles/);
});

test('shares concurrent requests and refreshes expired counts', async () => {
  const { guild, members } = fixture();
  let calls = 0, time = 0;
  guild.members.fetch = async () => { calls++; return members; };
  const service = createServerMembers({ now: () => time });
  await Promise.all([service.read(guild), service.context(guild), service.reply(guild)]);
  assert.equal(calls, 1);
  members.set('new', { user: { bot: false }, presence: { status: 'idle' } });
  guild.memberCount++;
  time = 60001;
  assert.equal((await service.read(guild)).humans, 6);
  assert.equal(calls, 2);
});

test('missing, incomplete, unavailable, and failed data never become exact counts', async () => {
  const { guild } = fixture();
  const service = createServerMembers();
  assert.match(await service.reply(null), /dentro del servidor/);
  guild.memberCount = 100;
  assert.equal(await service.read(guild), null);
  assert.match(await service.context(guild), /No pude obtener/);
  const broken = { members: { fetch: async () => { throw new Error('timeout'); } } };
  assert.equal(await service.read(broken), null);
  assert.equal(await service.read({ available: false }), null);
});

test('recognizes natural member queries without intercepting voice or historical activity', () => {
  for (const q of ['cuánta gente hay en el server', 'cuántos usuarios reales hay sin bots',
    'cuántos conectados y desconectados hay', 'total de miembros', 'cuántos están online']) {
    assert.equal(isMemberCountQuestion(q), true, q);
  }
  for (const q of ['cuántos hay en voz', 'cuántos usuarios se conectaron ayer', 'actividad de hoy']) {
    assert.equal(isMemberCountQuestion(q), false, q);
  }
});
