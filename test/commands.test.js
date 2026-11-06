const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const utils = require("../src/commandUtils");

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

function bot(activityContext = 'Actividad de voz: 3 participantes hoy.') {
  const discord = require("discord.js");
  const client = new EventEmitter();
  let logins = 0;
  client.ws = { ping: 42 };
  client.login = async () => { logins++; };
  const aiCalls = [];
  const muteCalls = [];
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/index"), "utf8"), {
    require(name) {
      if (name === "dotenv") return { config() {} };
      if (name === "discord.js") return { ...discord, Client: function () { return client; } };
      if (name === "./ai") return { clearHistory() {}, askAI: async (...args) => { aiCalls.push(args); return "x".repeat(4200); } };
      if (name === './operationalLog') return { createOperationalLog: () => Object.assign(async () => {}, { withContext: (ctx, fn) => fn() }) };
      if (name === "./keepAlive") return () => {};
      if (name === "./commandUtils") return utils;
      if (name === "./botCapabilities") return require("../src/botCapabilities");
      if (name === "./moderation") return require("../src/moderation");
      if (name === "./textMute") return { createTextMutes: () => ({ mute: async (...args) => muteCalls.push(args) }) };
      if (name === "./muteStore") return require("../src/muteStore");
      if (name === './activityReply') return require('../src/activityReply');
      if (name === './activityQuery') return require('../src/activityQuery');
      if (name === './serverAudit') return { auditRequested: require('../src/serverAudit').auditRequested,
        createServerAudit: () => ({ reply: async () => 'Consulta de auditoría; sin acciones.' }) };
      if (name === './serverActivity') return { createServerActivity: () => ({ message: async () => {}, context: async () => activityContext }) };
      if (name === "./boundedMap") return require("../src/boundedMap");
      if (["./usageBudget", "./voiceAudio", "./voice", "./wakeListener", "./voiceLog", "./deleteMessages"].includes(name)) return require(`../src/${name.slice(2)}`);
      throw new Error(name);
    },
    process: { env: {}, on() {}, once() {}, exit() { throw new Error("Unexpected exit"); } }, console,
  });
  return { client, aiCalls, logins, muteCalls };
}

function interaction(commandName, argument, guild = null) {
  const replies = [];
  return {
    commandName, guild, user: { id: "1", username: "tester" }, channel: { id: "2", name: "general" },
    options: { getString: () => argument, getInteger: () => argument },
    isChatInputCommand: () => true, isRepliable: () => true, replies,
    async deferReply() { this.deferred = true; },
    async editReply(payload) { this.replied = true; replies.push(payload); },
    async followUp(payload) { replies.push(payload); },
  };
}

test("single login, DM guards, and slash long replies", async () => {
  const { client, logins, aiCalls } = bot();
  assert.equal(logins, 1);
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
  const guild = { id: 'g', name: 'The Goats', members: { cache: new Map() } };
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
  const guild = { id: 'g', name: 'The Goats', members: { cache: new Map() } };
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
  const guild = { id: 'g', name: 'The Goats', members: { cache: new Map() }, voiceStates: { cache: new Map() } };
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
  const guild = { id: 'guild', members: { fetch: async () => ({ roles: { cache: { some: fn => fn({ name: 'Sigma' }) } } }), fetchMe: async () => ({ id: 'bot' }) } };
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
  const guild = { members: { fetch: async id => {
    fetched.push(id);
    if (id === "1") return { roles: { cache: { some: predicate => authorized && predicate({ name: "Sigma" }) } } };
    assert.equal(id, "123");
    return { user: { username: "target" }, voice: { channelId: "voice", channel: { name: "General" }, disconnect: async () => { disconnects++; } } };
  } } };
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
      roles: { cache: { some: predicate => predicate({ name: "Sigma" }) }, highest: { comparePositionTo: () => 1 } },
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
