const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType: T, PermissionFlagsBits: P } = require('discord.js');
const { createChannelKnowledge, isContentQuestion, SOURCES } = require('../src/channelKnowledge');
const at = Date.parse('2026-11-10T04:00:00Z');
function fixture({ allowed = true, publicSource = true, error = false, archived = false, rows, maxPages = 2 } = {}) {
  let fetches = 0;
  const member = { id: 'reader' }, me = { id: 'bot' };
  const message = (id, timestamp = at) => ({ id, createdTimestamp: timestamp, author: { id: 'RADAR', bot: true },
    content: '', embeds: [{ title: 'Python para todos', description: 'Curso completo', fields: [{ name: 'Nivel', value: 'Inicial' }], url: 'https://example.com/python' }], attachments: new Map() });
  const channel = (id, type) => ({ id, guildId: 'guild', name: 'Python', type, permissionsFor: () => ({ has: flags => allowed && flags.includes(P.ReadMessageHistory) }),
    messages: { fetch: async () => { fetches++; if (error) throw Error('network'); return new Collection((rows || [message('100')]).map(m => [m.id, m])); } } });
  const thread = { ...channel('123', T.PublicThread), parentId: SOURCES.biblioteca, archiveTimestamp: at };
  const sources = new Map(Object.values(SOURCES).map(id => [id, channel(id, T.GuildText)]));
  if (archived) sources.set(SOURCES.biblioteca, { ...channel(SOURCES.biblioteca, T.GuildForum), threads: {
    fetchActive: async () => ({ threads: new Collection() }),
    fetchArchived: async () => ({ threads: new Collection([[thread.id, thread]]), hasMore: false }),
  } });
  const guild = { id: 'guild', channels: { fetch: async id => sources.get(id) }, members: {
    fetch: async () => member, fetchMe: async () => me,
  } };
  const reader = createChannelKnowledge({ now: () => at + 60000, visibility: async () => () => publicSource, maxPages });
  return { read: question => reader.read(guild, question, { requesterId: member.id, responseChannelId: 'general' }),
    message, get fetches() { return fetches; } };
}
test('detects requested content without turning casual greetings into searches', () => {
  for (const q of ['noticias relevantes de hoy', 'resume las noticias', 'qué cursos hay de Python', 'lee biblioteca', 'noticias y cursos', `<#${SOURCES.noticias}>`]) assert.ok(isContentQuestion(q), q);
  assert.equal(isContentQuestion('hola TARS'), false);
});
test('reads bot embeds and archived forum posts with citations', async () => {
  const f = fixture({ archived: true });
  const result = await f.read('cursos de Python');
  assert.match(result.context, /Python para todos/);
  assert.match(result.context, /Inicial/);
  assert.match(result.context, /https:\/\/discord.com\/channels\/guild\/123\/100/);
  assert.match(result.context, /sin filtro de fecha/);
});
test('today follows Chile midnight and courses may use older material', async () => {
  const f = fixture();
  const rows = [f.message('old', Date.parse('2026-11-10T02:59:00Z')), f.message('today', Date.parse('2026-11-10T03:00:00Z'))];
  const reader = fixture({ rows });
  const news = await reader.read('noticias de hoy');
  assert.match(news.context, /\/today/); assert.doesNotMatch(news.context, /\/old/);
  const library = await reader.read('cursos de Python');
  assert.match(library.context, /\/old/);
});
test('denied audiences and missing history permission never read messages', async () => {
  for (const options of [{ allowed: false }, { publicSource: false }]) {
    const f = fixture(options);
    assert.match((await f.read('noticias')).reply, /permisos actuales/);
    assert.equal(f.fetches, 0);
  }
});
test('failures, empty results, dates and truncation are explicit', async () => {
  assert.match((await fixture({ error: true }).read('noticias')).reply, /lecturas fallaron/);
  assert.match((await fixture({ rows: [] }).read('noticias')).reply, /0 publicaciones/);
  assert.match((await fixture().read('noticias el lunes')).reply, /YYYY-MM-DD/);
  const f = fixture();
  const limited = fixture({ maxPages: 1, rows: Array.from({ length: 100 }, (_, i) => f.message(String(i))) });
  assert.match((await limited.read('noticias')).context, /Lectura parcial/);
});
test('both requested sources contribute to the retrieved sample', async () => {
  const result = await fixture().read('noticias y cursos');
  assert.match(result.context, /"canal":"noticias"/);
  assert.match(result.context, /"canal":"biblioteca"/);
});
