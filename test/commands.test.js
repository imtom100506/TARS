const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const utils = require("../src/commandUtils");
process.env.TARS_MODERATOR_ROLE_IDS = 'test-moderator';

test("summary limits and defaults are strict", () => {
  for (const value of [undefined, null, ""]) assert.equal(utils.summaryCount(value), 20);
  for (const value of [1, "50"]) assert.equal(utils.summaryCount(value), Number(value));
  for (const value of [0, -1, 51, 1.5, "abc"]) assert.throws(() => utils.summaryCount(value));
  for (const text of ["resume -5", "resume 0", "resume 2,5", "resume 51"]) assert.throws(() => utils.countFromText(text));
});

test("voice targets require exactly one explicit user mention", () => {
  assert.equal(utils.mentionedUserId("saca a tom"), null);
  assert.equal(utils.mentionedUserId("saca a <@123>"), "123");
  assert.equal(utils.mentionedUserId("saca a <@!123>"), "123");
  assert.equal(utils.mentionedUserId("saca a <@123> y <@456>"), null);
  assert.equal(utils.mentionedUserId("saca a <@&123>"), null);
});

test("long output preserves text and unicode within Discord limits", () => {
  const text = "a".repeat(1899) + "😀\n" + "b".repeat(4000);
  const chunks = utils.splitResponse(text);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every(chunk => chunk.length <= 1900 && chunk.isWellFormed()));
});

function bot(activityContext = 'Actividad de voz: 3 participantes hoy.', options = {}) {
  const discord = require("discord.js");
  const client = new EventEmitter();
  let logins = 0;
  client.ws = { ping: 42 };
  client.login = async () => { logins++; };
  client.isReady = () => false;
  const aiCalls = [];
  const muteCalls = [];
  const auditCalls = [], activityCalls = [], resets = [], budgets = [];
  let readiness;
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/index"), "utf8"), {
    require(name) {
      if (name === "dotenv") return { config() {} };
      if (name === "discord.js") return { ...discord, Client: function () { return client; } };
      if (name === "./ai") return { clearHistory: id => resets.push(id), setBudget: budget => budgets.push(budget), askAI: async (...args) => { aiCalls.push(args); return "x".repeat(4200); } };
      if (name === './operationalLog') return { createOperationalLog: () => Object.assign(async () => {}, { withContext: (ctx, fn) => fn() }) };
      if (name === "./keepAlive") return (_, { ready }) => { readiness = ready; };
      if (name === "./commandUtils") return utils;
      if (name === "./botCapabilities") return require("../src/botCapabilities");
      if (name === "./moderation") return require("../src/moderation");
      if (name === "./textMute") return { createTextMutes: () => ({ mute: async (...args) => muteCalls.push(args) }) };
      if (name === "./muteStore") return require("../src/muteStore");
      if (name === './activityReply') return require('../src/activityReply');
      if (name === './activityQuery') return require('../src/activityQuery');
      if (name === './channelKnowledge' && options.knowledge) return {
        isContentQuestion: require('../src/channelKnowledge').isContentQuestion,
        createChannelKnowledge: () => ({ read: options.knowledge }),
      };
      if (name === './serverAudit') return { auditRequested: require('../src/serverAudit').auditRequested,
        createServerAudit: () => ({ reply: async (...args) => { auditCalls.push(args); return options.auditReply || 'Consulta de auditoría; sin acciones.'; } }) };
      if (name === './serverActivity') return { createServerActivity: () => ({ message: async () => {}, context: async (...args) => { activityCalls.push(args); return activityContext; } }) };
      if (name === "./boundedMap") return require("../src/boundedMap");
      if (["./usageBudget", "./deleteMessages"].includes(name)) return require(`../src/${name.slice(2)}`);
      if (name.startsWith('./')) return require(`../src/${name.slice(2)}`);
      if (name.startsWith('node:')) return require(name);
      throw new Error(name);
    },
    process: { env: {}, on() {}, once() {}, exit() { throw new Error("Unexpected exit"); } }, console,
    __dirname: require('node:path').resolve(__dirname, '../src'), global: { fetch: global.fetch }, setTimeout,
  });
  return { client, aiCalls, logins, muteCalls, auditCalls, activityCalls, resets, budgets, readiness };
}

function activityGuild() {
  const { Collection, PermissionFlagsBits: P } = require('discord.js');
  const actor = { id: '1' };
  const make = (id, readable, publicChannel) => ({ id, guildId: 'g',
    permissionOverwrites: { cache: new Collection() },
    permissionsFor: subject => ({ has: permission => permission === P.ViewChannel && (typeof subject === 'string' ? publicChannel : readable) }) });
  const channels = new Collection([
    ['public', make('public', true, true)], ['private', make('private', true, false)],
    ['2', make('2', true, false)], ['denied', make('denied', false, true)],
  ]);
  return { id: 'g', name: 'The Goats', roles: { fetch: async () => new Collection() },
    channels: { cache: channels, fetch: async id => id ? channels.get(id) : channels,
      fetchActiveThreads: async () => ({ threads: new Collection() }) },
    members: { cache: new Map(), fetch: async request => {
      assert.equal(request.user, '1'); assert.equal(request.force, true); return actor;
    } } };
}

function interaction(commandName, argument, guild = null) {
  const replies = [];
  return {
    commandName, guild, user: { id: "1", username: "tester" }, channel: { id: "2", name: "general" },
    options: { getString: () => argument, getInteger: () => argument },
    isChatInputCommand: () => true, isRepliable: () => true, replies,
    async deferReply(payload) { this.deferred = true; this.deferOptions = payload; },
    async editReply(payload) { this.replied = true; replies.push(payload); },
    async followUp(payload) { replies.push(payload); },
  };
}

test('news summaries and courses route to configured sources through slash and prefix, not chat summaries or audit', async () => {
  const calls = [];
  const { client, aiCalls, auditCalls, activityCalls } = bot('', { knowledge: async (...args) => {
    calls.push(args); return { context: 'Publicaciones consultadas con fuentes' };
  } });
  const guild = activityGuild();
  const request = interaction('tars', 'resume las noticias relevantes de hoy', guild);
  await client.listeners('interactionCreate')[0](request);
  await client.listeners('messageCreate')[0]({ content: '!tars qué cursos de Python hay en biblioteca',
    author: { id: '1', username: 'tester' }, guild, channel: { id: '2', sendTyping: async () => {} }, reply: async () => {} });
  assert.equal(calls.length, 2);
  assert.equal(aiCalls.length, 2);
  assert.equal(auditCalls.length, 0);
  assert.equal(activityCalls.length, 0);
  for (const call of aiCalls) {
    assert.equal(call[2].groundedContent, true);
    assert.match(call[2].context, /Publicaciones consultadas/);
  }
  assert.equal(calls[0][2].requesterId, '1');
  assert.equal(calls[0][2].responseChannelId, '2');
});

test('empty or denied content bypasses AI rather than inventing news', async () => {
  const { client, aiCalls } = bot('', { knowledge: async () => ({ reply: 'No hay publicaciones visibles.' }) });
  const request = interaction('tars', 'noticias de hoy', activityGuild());
  await client.listeners('interactionCreate')[0](request);
  assert.equal(aiCalls.length, 0);
  assert.equal(request.replies[0].content, 'No hay publicaciones visibles.');
});

test('screenshot question and disconnection phrasing use activity through both command paths', async () => {
  const context = 'Datos\n' + JSON.stringify({ cobertura: {}, hoy: {}, finVoz: {
    start: '2026-11-09T20', end: '2026-11-10T06', last: { at: Date.parse('2026-11-10T05:42:00Z'), kind: 'leave' },
  } });
  const { client, aiCalls, auditCalls } = bot(context);
  const request = interaction('tars', 'a qué hora se desconectaron de voz anoche', activityGuild());
  await client.listeners('interactionCreate')[0](request);
  const replies = [];
  await client.listeners('messageCreate')[0]({ content: '!tars hasta que hora se quedaron anoche aprox?',
    author: { id: '1', username: 'tester' }, guild: activityGuild(), channel: { id: '2', sendTyping: async () => {} }, reply: async payload => replies.push(payload) });
  assert.match(request.replies[0].content, /02:42/);
  assert.match(replies[0].content, /02:42/);
  assert.equal(aiCalls.length, 0); assert.equal(auditCalls.length, 0);
});

test("single login, DM guards, and slash long replies", async () => {
  const { client, logins, aiCalls, budgets, readiness } = bot();
  assert.equal(logins, 1);
  assert.equal(budgets.length, 1, 'Text-only mode must still install the persisted budget');
  assert.equal(typeof budgets[0].reserve, 'function');
  assert.equal(readiness(), false, 'No readiness before Discord and stores are initialized');
  const handler = client.listeners("interactionCreate")[0];
  for (const [command, argument] of [["usuarios", null], ["resumir", 10], ["tars", "saca a <@123>"]]) {
    const request = interaction(command, argument);
    await handler(request);
    assert.match(request.replies[0].content, /solo está disponible/);
  }
  const request = interaction("tars", "hola");
  await handler(request);
  assert.equal(aiCalls.length, 1);
  assert.equal(request.replies.length, 3);
  assert.equal(request.replies.map(reply => reply.content).join(""), "x".repeat(4200));
});

test('ordinary slash and prefix questions receive voice activity without a new command', async () => {
  const { client, aiCalls } = bot();
  const guild = activityGuild();
  await client.listeners('interactionCreate')[0](interaction('tars', '¿Cómo ha ido la actividad del servidor?', guild));
  await client.listeners('messageCreate')[0]({
    content: '!tars ¿Quién participa más en voz hoy?', author: { id: '1', username: 'tester' }, guild,
    channel: { id: '2', sendTyping: async () => {} }, reply: async () => {},
  });
  assert.equal(aiCalls.length, 2);
  for (const call of aiCalls) assert.match(call[2].context, /Actividad de voz: 3 participantes hoy/);
});

test('greetings omit activity context for slash and prefix conversations', async () => {
  const { client, aiCalls } = bot();
  const guild = activityGuild();
  await client.listeners('interactionCreate')[0](interaction('tars', 'Buenos días TARS', guild));
  await client.listeners('messageCreate')[0]({
    content: '!tars Hola, qué tal?', author: { id: '1', username: 'tester' }, guild,
    channel: { id: '2', sendTyping: async () => {} }, reply: async () => {},
  });
  assert.equal(aiCalls.length, 2);
  for (const call of aiCalls) assert.doesNotMatch(call[2].context, /Actividad de voz|miembros humanos en caché/);
});

test('slash and prefix activity metrics stay conversational and bypass LLM rewriting', async () => {
  const { createServerActivity } = require('../src/serverActivity');
  const guild = { ...activityGuild(), voiceStates: { cache: new Map() } };
  const tracker = createServerActivity({ store: { read: async () => null, write: async () => {} }, now: () => Date.parse('2026-11-05T21:18:00Z') });
  const context = await tracker.context(guild, 'actividad');
  const { client, aiCalls } = bot(context);
  const request = interaction('tars', '¿Cómo ha ido la actividad del servidor?', guild);
  await client.listeners('interactionCreate')[0](request);
  const replies = [];
  await client.listeners('messageCreate')[0]({
    content: '!tars Como va la actividad del server', author: { id: '1', username: 'tester' }, guild,
    channel: { id: '2', sendTyping: async () => {} }, reply: async payload => replies.push(payload),
  });
  assert.equal(aiCalls.length, 0);
  assert.match(request.replies[0].content, /Ahora mismo no hay nadie/);
  assert.match(replies[0].content, /Ahora mismo no hay nadie/);
  assert.doesNotMatch(replies[0].content, /Registro parcial|2026/);
});

test('audit questions including kick or resume never execute moderation or fetch channel messages', async () => {
  const { client, aiCalls, muteCalls } = bot();
  const guild = { id: 'g' };
  for (const text of ['quién hizo kick a <@123>', 'resume la auditoría', 'quién muteó a <@123>', 'quién movió a <@123>']) {
    const request = interaction('tars', text, guild);
    await client.listeners('interactionCreate')[0](request);
    assert.match(request.replies[0].content, /Consulta de auditoría/);
  }
  assert.equal(aiCalls.length, 0);
  assert.equal(muteCalls.length, 0);
});

test("slash and prefix reject invalid summaries before fetching messages", async () => {
  const { client, aiCalls } = bot();
  const request = interaction("resumir", -1, {});
  await client.listeners("interactionCreate")[0](request);
  assert.match(request.replies[0].content, /entre 1 y 50/);
  const replies = [];
  await client.listeners("messageCreate")[0]({
    content: "!resumir 0", author: { id: "1", username: "tester" }, guild: {},
    channel: { id: "2", sendTyping: async () => {} }, reply: async payload => replies.push(payload),
  });
  assert.match(replies[0].content, /entre 1 y 50/);
  assert.equal(aiCalls.length, 0);
});

test('prefix deletion and its confirmation bypass AI and use the requesting member only', async () => {
  const { client, aiCalls } = bot(); const replies = [], deleted = [];
  const rows = new Map(Array.from({ length: 60 }, (_, i) => [String(i), { id: String(i), createdTimestamp: Date.now() - 1000, author: { id: 'human' } }]));
  const channel = { id: 'deletion-test', messages: { fetch: async () => rows }, permissionsFor: () => ({ has: () => true }),
    bulkDelete: async ids => { deleted.push(ids); return new Map(ids.map(id => [id, rows.get(id)])); } };
  const guild = { id: 'guild', members: { fetch: async request => {
    assert.equal(request.force, true);
    return { roles: { cache: { some: fn => fn({ id: 'test-moderator', name: 'Sigma' }) } } };
  }, fetchMe: async () => ({ id: 'bot' }) } };
  const invoke = async (content, id = 'human') => client.listeners('messageCreate')[0]({ id: 'command', content, author: { id }, guild, channel, reply: async payload => replies.push(payload) });
  await invoke('!borrar 60'); assert.equal(deleted.length, 0);
  await invoke('sí', 'other'); assert.equal(deleted.length, 0);
  await invoke('sí'); assert.equal(deleted[0].length, 60); assert.equal(aiCalls.length, 0);
  assert.match(replies.at(-1).content, /Borrados 60/);
});

test("voice disconnect checks role and never resolves a target by username", async () => {
  const { client } = bot();
  let authorized = false;
  let disconnects = 0;
  const fetched = [];
  const guild = { id: 'g', ownerId: 'owner', channels: { fetch: async () => ({ id: 'voice', permissionsFor: () => ({ has: () => true }) }) }, members: {
    fetchMe: async () => ({ id: 'bot' }), fetch: async ({ user: id, force }) => {
      assert.equal(force, true); fetched.push(id);
      if (id === "1") return { roles: { highest: { comparePositionTo: () => 1 }, cache: { some: predicate => authorized && predicate({ id: 'test-moderator', name: "Sigma" }) } } };
      assert.equal(id, "123");
      return { manageable: true, roles: { highest: {} }, user: { username: "target" }, voice: { channelId: "voice", disconnect: async () => { disconnects++; } } };
    },
  } };
  const handler = client.listeners("interactionCreate")[0];
  await handler(interaction("tars", "saca a <@123>", guild));
  assert.equal(disconnects, 0);
  authorized = true;
  await handler(interaction("tars", "saca a target", guild));
  assert.equal(disconnects, 0);
  await handler(interaction("tars", "saca a <@123>", guild));
  assert.equal(disconnects, 1);
  assert.deepEqual(fetched, ["1", "1", "1", "123"]);
});

test("command questions and invented commands bypass AI and moderation", async () => {
  const { client, aiCalls } = bot();
  const slash = client.listeners("interactionCreate")[0];
  for (const text of ["help", "commands", "dime todos tus comandos", "qué comandos de admin como kick puedes usar"] ) {
    const request = interaction("tars", text, {});
    await slash(request);
    assert.match(request.replies[0].content, /!resumir/);
    assert.match(request.replies[0].content, /Líder o Sigma/);
    assert.doesNotMatch(request.replies[0].content, /!tars ban/);
  }
  for (const text of ["analyst on", "detalle", "re‑load", "credit", "limit 2", "time @tom", "role add <@123> OG", "purge 20", "voicekick <@123>", "play Interstellar", "/play Interstellar"]) {
    const replies = [];
    await client.listeners("messageCreate")[0]({
      content: `!tars ${text}`, author: { id: "1", username: "tester" }, guild: {},
      channel: { id: "2", sendTyping: async () => {} }, reply: async payload => replies.push(payload),
    });
    assert.match(replies[0].content, /no existe en TARS/);
  }
  assert.equal(aiCalls.length, 0);
});

test("prefix and slash moderation bypass AI even with command words in the nickname", async () => {
  const { client, aiCalls, muteCalls } = bot();
  const calls = [];
  const guild = { ownerId: "owner", members: {
    fetch: async ({ user }) => user === "1" ? {
      roles: { cache: { some: predicate => predicate({ id: 'test-moderator', name: "Sigma" }) }, highest: { comparePositionTo: () => 1 } },
      permissions: { has: () => true },
    } : {
      id: "123", user: { bot: false }, roles: { highest: {} }, manageable: true,
      permissions: { has: () => false }, isCommunicationDisabled: () => false,
      timeout: async () => { throw new Error("No timeout"); }, setNickname: async name => calls.push(name),
    },
    fetchMe: async () => ({ permissions: { has: () => true } }),
  } };
  const request = interaction("tars", "mutea a <@123> por 10 minutos", guild);
  await client.listeners("interactionCreate")[0](request);
  assert.match(request.replies[0].content, /Silenciado/);
  const replies = [];
  await client.listeners("messageCreate")[0]({
    content: "!tars cambia el apodo de <@123> a saca resume comandos", author: { id: "1", username: "tester" }, guild,
    channel: { id: "2", sendTyping: async () => {} }, reply: async payload => replies.push(payload),
  });
  assert.equal(muteCalls[0][2], 600000);
  assert.deepEqual(calls, ["saca resume comandos"]);
  assert.match(replies[0].content, /Apodo actualizado/);
  const dm = interaction("tars", "mutea a <@123> por 10 minutos");
  await client.listeners("interactionCreate")[0](dm);
  assert.match(dm.replies[0].content, /solo está disponible/);
  assert.equal(aiCalls.length, 0);
});

test('removed command is absent from help and ignored in slash and prefix', async () => {
  const { client, aiCalls } = bot();
  assert.doesNotMatch(require('../src/botCapabilities').HELP, /privacidad/i);
  const request = interaction('privacidad', 'estado');
  await client.listeners('interactionCreate')[0](request);
  assert.equal(request.replies.length, 0);
  let replies = 0;
  await client.listeners('messageCreate')[0]({ content: '!privacidad', author: { id: '1' }, channel: { id: 'c' }, reply: async () => { replies++; } });
  assert.equal(replies, 0); assert.equal(aiCalls.length, 0);
});

test('conversation scope separates DMs, guilds, channels and users, while summaries reuse their own channel scope', async () => {
  const { client, aiCalls } = bot(); const slash = client.listeners('interactionCreate')[0];
  for (const [guild, channelId, userId] of [[null, 'dm-1', '1'], [{ id: 'g1' }, 'c1', '1'], [{ id: 'g1' }, 'c2', '1'], [{ id: 'g2' }, 'c1', '1'], [{ id: 'g1' }, 'c1', 'other']]) {
    const request = interaction('tars', 'Hola, conversemos.', guild);
    request.channel.id = channelId; request.user.id = userId; await slash(request);
  }
  const scopes = aiCalls.map(call => call[2].conversationId);
  assert.equal(new Set(scopes).size, 5);
  assert.deepEqual(JSON.parse(scopes[0]), ['dm', 'dm-1', '1']);
  assert.deepEqual(JSON.parse(scopes[1]), ['g1', 'c1', '1']);
  const summary = interaction('resumir', 1, { id: 'g1' });
  summary.channel.id = 'c1'; summary.channel.messages = { fetch: async ({ limit }) => {
    assert.equal(limit, 1); return new Map([['m1', { id: 'm1', author: { username: 'person', bot: false }, content: 'Una conversación.' }]]);
  } };
  await slash(summary);
  assert.equal(aiCalls.at(-1)[2].conversationId, scopes[1]);
});

test('reset removes the requester from every recent channel without erasing other members', async () => {
  const { client, aiCalls, resets } = bot(); const receive = client.listeners('messageCreate')[0];
  for (const channelId of ['a', 'b']) for (const [id, text] of [['1', 'dato privado del solicitante'], ['2', 'aporte del compañero']]) {
    await receive({ content: text, author: { id, username: id }, channel: { id: channelId } });
  }
  const before = interaction('tars', 'Hola'); before.channel.id = 'a';
  await client.listeners('interactionCreate')[0](before);
  assert.match(aiCalls.at(-1)[2].context, /dato privado del solicitante/);
  await receive({ content: '!reset', author: { id: '1', username: '1' }, channel: { id: 'a' }, reply: async () => {} });
  assert.deepEqual(resets, ['1']);
  for (const channelId of ['a', 'b']) {
    const next = interaction('tars', 'Hola otra vez'); next.channel.id = channelId;
    await client.listeners('interactionCreate')[0](next);
    assert.doesNotMatch(aiCalls.at(-1)[2].context, /dato privado del solicitante|!reset/);
    assert.match(aiCalls.at(-1)[2].context, /aporte del compañero/);
  }
});

test('activity integration supplies audience visibility and excludes private or inaccessible channels', async () => {
  const { client, activityCalls } = bot();
  await client.listeners('interactionCreate')[0](interaction('tars', 'Cómo va la actividad del servidor', activityGuild()));
  assert.equal(activityCalls.length, 1);
  const allowed = activityCalls[0][3].canViewChannel;
  const channel = (id, memberCanView, everyoneCanView) => ({ id, permissionsFor: subject => ({ has: permission => {
    assert.equal(permission, require('discord.js').PermissionFlagsBits.ViewChannel);
    return typeof subject === 'string' ? everyoneCanView : memberCanView;
  } }) });
  assert.equal(allowed(channel('public', true, true)), true);
  assert.equal(allowed(channel('private', true, false)), false);
  assert.equal(allowed(channel('2', true, false)), true, 'The response channel has the same audience');
  assert.equal(allowed(channel('denied', false, true)), false);
  assert.equal(allowed(undefined), false);
});

test('prefix audit responses go only to requester DMs and preserve authorization context', async () => {
  const { client, auditCalls } = bot(undefined, { auditReply: 'auditoría privada '.repeat(180) });
  const direct = [], publicReplies = [];
  await client.listeners('messageCreate')[0]({ content: '!tars quién muteó a <@123>', guild: { id: 'g' },
    author: { id: '1', username: 'tester', send: async payload => direct.push(payload) },
    channel: { id: '2', sendTyping: async () => {} }, reply: async payload => publicReplies.push(payload),
  });
  assert.ok(direct.length > 1);
  assert.equal(direct.map(payload => payload.content).join(''), 'auditoría privada '.repeat(180));
  assert.ok(direct.every(payload => payload.allowedMentions.parse.length === 0));
  assert.equal(publicReplies.length, 0);
  assert.equal(auditCalls[0][2].requesterId, '1'); assert.equal(auditCalls[0][2].channelId, '2');
});

test('closed requester DMs never expose an audit response in the public channel', async () => {
  const { client } = bot(undefined, { auditReply: 'DETALLE PRIVADO DE AUDITORÍA' }); const replies = [];
  await client.listeners('messageCreate')[0]({ content: '!tars quién muteó a <@123>', guild: { id: 'g' },
    author: { id: '1', send: async () => { throw Error('Cannot DM'); } },
    channel: { id: '2', sendTyping: async () => {} }, reply: async payload => replies.push(payload),
  });
  assert.equal(replies.length, 1); assert.match(replies[0].content, /Activa tus mensajes directos o usa \/tars/);
  assert.doesNotMatch(replies[0].content, /DETALLE PRIVADO/);
});

test('every fragment of slash audit responses remains ephemeral', async () => {
  const { client } = bot(undefined, { auditReply: 'auditoría privada '.repeat(250) });
  const request = interaction('tars', 'Quién hizo kick a <@123>', { id: 'g' });
  await client.listeners('interactionCreate')[0](request);
  assert.equal(request.deferOptions.flags, 64);
  assert.ok(request.replies.length > 1);
  for (const reply of request.replies.slice(1)) assert.equal(reply.flags, 64, 'Follow-up audit chunks must explicitly stay ephemeral');
});

test('removed commands are ignored in both slash and prefix routes', async () => {
  const { client, aiCalls } = bot();
  for (const name of ['entrar', 'escuchar', 'salir']) {
    const command = interaction(name);
    await client.listeners('interactionCreate')[0](command);
    assert.equal(command.deferred, undefined);
    assert.equal(command.replies.length, 0);
    const replies = [];
    await client.listeners('messageCreate')[0]({ content: '!' + name,
      author: { id: '1', username: 'tester' }, channel: { id: 'dm' },
      reply: async value => replies.push(value) });
    assert.equal(replies.length, 0);
  }
  assert.equal(aiCalls.length, 0);
});
