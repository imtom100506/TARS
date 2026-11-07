require("dotenv").config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { askAI, clearHistory, setBudget } = require("./ai");
const keepAlive = require("./keepAlive");
const { summaryCount, countFromText, splitResponse } = require("./commandUtils");
const path = require('node:path');
const { conversationScope } = require('./conversationScope');
const { createOperationalLog } = require('./operationalLog');
const { createFileStore } = require('./fileStore');
const { createRecentContext } = require('./recentContext');
const { createRequestLimits } = require('./requestLimits');
const { activityVisibility } = require('./accessPolicy');
const { disconnectMember } = require('./disconnectMember');
const { HELP, commandReply } = require("./botCapabilities");
const { parseModeration, moderate } = require("./moderation");
const { createTextMutes } = require("./textMute");
const { createDiscordMuteStore } = require("./muteStore");
const { createUsageBudget } = require("./usageBudget");
const { deleteMessages, confirmDelete } = require('./deleteMessages');
const { createServerActivity, MARKER: ACTIVITY_MARKER } = require('./serverActivity');
const { activityReply } = require('./activityReply');
const { isActivityQuestion } = require('./activityQuery');
const { createServerAudit, auditRequested } = require('./serverAudit');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildModeration],
  partials: [Partials.Channel],
  ws: { large_threshold: 50 },
  rest: { timeout: 60000 },
  allowedMentions: { parse: [], repliedUser: false },
});
const sendLog = createOperationalLog(client);
const health = { activity: 0, mutes: 0, budget: 0 };
const allowRequest = createRequestLimits();
const muteStateChannel = process.env.TARS_STATE_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
const activity = createServerActivity({ store: muteStateChannel ? createDiscordMuteStore(client, muteStateChannel,
  global.fetch, ACTIVITY_MARKER, 'tars-activity.json') : undefined });
const activityError = error => { health.activity = 0; console.error('[actividad]', error.message); };
const audit = createServerAudit({ activity });
async function getAuditReply(guild, question, options) {
  if (!auditRequested(question)) return null;
  try { return await audit.reply(guild, question, options); }
  catch (error) { activityError(error); return 'Ahora no puedo consultar ese registro. Prueba de nuevo en un rato.'; }
}
client.on('guildAuditLogEntryCreate', (entry, guild) => { void audit.record(entry, guild).catch(activityError); });
const textMutes = createTextMutes({ store: muteStateChannel ? createDiscordMuteStore(client, muteStateChannel) : undefined });
const channelContext = createRecentContext();
const rate = (key, fallback) => { const value = Number(process.env[key]); return Number.isInteger(value) && value > 0 && value <= 60 ? value : fallback; };
const budget = createUsageBudget({ minuteRequests: rate('TARS_LLM_REQUESTS_PER_MINUTE', 6), store: muteStateChannel ? createDiscordMuteStore(client, muteStateChannel,
  global.fetch, 'TARS · Presupuesto IA · No borrar', 'tars-usage.json') : createFileStore(path.join(process.env.TARS_DATA_DIR || path.join(__dirname, '..', 'data'), 'usage.json')) });
setBudget(budget);
client.on('voiceStateUpdate', (oldState, newState) => {
  void audit.voice(oldState, newState).catch(activityError);
  void activity.voice(oldState, newState).catch(activityError);
});
async function shutdown() {
  client.destroy();
  await activity.flush().catch(activityError);
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
client.on('guildMemberAdd', member => { void activity.member(member, true).catch(activityError); });
client.on('guildMemberRemove', member => { void activity.member(member, false).catch(activityError); });
client.on('guildCreate', guild => { void activity.sync(guild).catch(activityError); });
client.on('shardDisconnect', (_, shardId) => {
  const ids = [...client.guilds.cache.values()].filter(g => g.shardId === shardId).map(g => g.id);
  void activity.pause(ids).catch(activityError);
});
const syncActivityShard = shardId => {
  for (const guild of client.guilds.cache.values()) if (guild.shardId === shardId) void activity.sync(guild).catch(activityError);
};
client.on('shardResume', syncActivityShard);
client.on('shardReady', syncActivityShard);

const commands = [
  new SlashCommandBuilder().setName("tars").setDescription("Habla con TARS")
    .addStringOption(o => o.setName("mensaje").setDescription("Tu mensaje para TARS").setRequired(true)),
  new SlashCommandBuilder().setName("reset").setDescription("Borra tu historial de conversación con TARS"),
  new SlashCommandBuilder().setName("ping").setDescription("Verifica si TARS está activo"),
  new SlashCommandBuilder().setName('borrar').setDescription('Borra mensajes recientes sin IA; más de 50 requiere confirmación')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad de mensajes (1 a 100)').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption(o => o.setName('usuario').setDescription('Filtrar por usuario (opcional)')),
  new SlashCommandBuilder().setName("ayuda").setDescription("Muestra todos los comandos disponibles"),
  new SlashCommandBuilder().setName("resumir").setDescription("TARS resume los últimos mensajes del canal")
    .addIntegerOption(o => o.setName("cantidad").setDescription("Mensajes a resumir (1 a 50)").setMinValue(1).setMaxValue(50)),
  new SlashCommandBuilder().setName("usuarios").setDescription("Lista usuarios conectados o con un rol específico")
    .addStringOption(o => o.setName("rol").setDescription("Nombre del rol a filtrar (opcional)")),
].map(command => command.toJSON());

client.once("ready", async () => {
  await activity.start(client.guilds.cache.values()).then(() => { health.activity = Date.now(); }).catch(activityError);
  const saveActivity = async () => {
    await activity.flush().then(() => { health.activity = Date.now(); }).catch(activityError);
    setTimeout(saveActivity, 60000).unref();
  };
  setTimeout(saveActivity, 60000).unref();
  console.log(`Bot conectado como: ${client.user.tag}`);
  void sendLog("conexion", { bot: client.user.tag, servidores: client.guilds.cache.size });
  const restoreMutes = async () => {
    try { health.mutes = await textMutes.sweep(client, sendLog) ? Date.now() : 0; }
    catch (error) { health.mutes = 0; console.error("No se pudo recuperar el registro de mutes de texto:", error.message); }
  };
  const checkBudget = async () => {
    try { await budget.check(); health.budget = Date.now(); }
    catch { health.budget = 0; console.error('[cuota] Almacenamiento no disponible.'); }
    setTimeout(checkBudget, 60000).unref();
  };
  await checkBudget();
  await restoreMutes();
  for (const guild of client.guilds.cache.values()) {
    try { await textMutes.syncGuild(guild); }
    catch (error) { health.mutes = 0; void sendLog("mute_texto_error", { servidor_id: guild.id, error: error.message }); }
  }
  // Evitar acumular revisiones si Discord tarda en responder.
  const reviewMutes = async () => {
    await restoreMutes();
    setTimeout(reviewMutes, 5000).unref();
  };
  setTimeout(reviewMutes, 5000).unref();
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  } catch (error) {
    console.error("Error registrando comandos:", error.message);
  }
});

client.on("channelCreate", channel => {
  void textMutes.syncChannel(channel).catch(error => {
    void sendLog("mute_texto_error", { canal_id: channel.id, error: error.message });
  });
});

function getServerContext(guild) {
  if (!guild) return "Conversación por mensaje privado.";
  let members = 0, online = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    members++;
    if (member.presence?.status && member.presence.status !== "offline") online++;
  }
  return `Contexto del servidor "${guild.name}": ${members} miembros humanos en caché, ${online} conectados observados.`;
}

async function getActivityContext(guild, question, requesterId, responseChannelId) {
  if (!guild || !isActivityQuestion(question)) return '';
  try {
    const canViewChannel = await activityVisibility(guild, requesterId, responseChannelId);
    return await activity.context(guild, question, requesterId, { canViewChannel });
  }
  catch (error) { if (error.code === 'ACTIVITY_PERIOD') throw error; activityError(error); return 'Estadísticas de actividad no disponibles por un error del registro. No inventes cifras.'; }
}

async function summarize(ctx, count) {
  const messages = await ctx.channel.messages.fetch({ limit: count });
  const selected = [...messages.values()].reverse().filter(message => !message.author.bot && message.id !== ctx.messageId);
  const history = selected.map(message => `${message.author.username}: ${message.content}`).join("\n");
  if (!history) return ctx.reply("No hay mensajes para resumir.");
  void sendLog("resumir", { usuario: ctx.user.username, canal: ctx.channel.name, cantidad: selected.length });
  const response = await askAI(ctx.user.id, `Resume estos mensajes del chat de Discord de forma breve y clara:\n\n${history}`, { brief: true, conversationId: conversationScope({ guildId: ctx.guild?.id, channelId: ctx.channel.id, userId: ctx.user.id }) });
  await ctx.reply(`**Resumen de ${selected.length} mensajes:**\n${response}`);
}

async function execute(ctx, command, argument) {
  if (command === "ping") return ctx.reply(`Pong! Latencia: **${client.ws.ping}ms**`);
  if (command === "ayuda") return ctx.reply(HELP);
  if (command === "reset") {
    clearHistory(ctx.user.id);
    channelContext.clearUser(ctx.user.id);
    void sendLog("reset", { usuario: ctx.user.username });
    return ctx.reply("Historial borrado. Empezamos de cero.");
  }
  const text = String(argument ?? "").trim();
  if (command === 'tars' && auditRequested(text)) return (ctx.privateReply || ctx.reply)(await getAuditReply(ctx.guild, text, { requesterId: ctx.user.id, channelId: ctx.channel.id }));
  if (command === 'borrar') return deleteMessages(ctx, text, { sendLog, clearContext: id => channelContext.delete(id) });
  const moderation = command === "tars" ? parseModeration(text) : null;
  if (moderation) return moderate(ctx, moderation, sendLog, textMutes);
  const directReply = command === "tars" ? commandReply(text) : null;
  if (directReply) return ctx.reply(directReply);
  const isKick = command === "tars" && /^(?:tars[, ]+)?(?:por favor[, ]+)?(kick|expulsa|saca|bota|desconecta)\b/i.test(text);
  const isSummary = command === "resumir" || (command === "tars" && /\bresum(?:e|ir)\b/i.test(text));
  if (!ctx.guild && (command === "usuarios" || isKick || isSummary)) {
    return ctx.reply("Este comando solo está disponible dentro de un servidor.");
  }
  if (command === "usuarios") {
    await ctx.guild.members.fetch();
    void sendLog("usuarios", { usuario: ctx.user.username, filtro: text || "conectados" });
    const role = text ? ctx.guild.roles.cache.find(role => role.name.toLowerCase() === text.toLowerCase()) : null;
    if (text && !role) return ctx.reply(`No encontré el rol "${text}".`);
    const members = role ? role.members.filter(member => !member.user.bot) : ctx.guild.members.cache.filter(
      member => !member.user.bot && member.presence?.status && member.presence.status !== "offline");
    return ctx.reply(`**${role ? `Usuarios con el rol "${role.name}"` : "Usuarios conectados ahora"}:**\n` +
      (members.map(member => `- ${member.user.username}`).join("\n") || "Ninguno"));
  }
  if (isKick) return disconnectMember(ctx, text, sendLog);
  if (isSummary) {
    if (!allowRequest(ctx.user.id, ctx.guild?.id)) return ctx.reply('Dame un momento antes de hacer otra consulta.');
    let count;
    try { count = command === "resumir" ? summaryCount(argument) : countFromText(text); }
    catch (error) { return ctx.reply(error.message); }
    return summarize(ctx, count);
  }
  if (!text) return ctx.reply("Escribe algo después de `!tars`");
  void sendLog("mensaje", { usuario: ctx.user.username, canal: ctx.channel.name || "privado", mensaje: text });
  const serverContext = isActivityQuestion(text) ? getServerContext(ctx.guild) : '';
  const recent = channelContext.get(ctx.channel.id) || [];
  if (!allowRequest(ctx.user.id, ctx.guild?.id)) return ctx.reply('Dame un momento antes de hacer otra consulta.');
  const activityContext = await getActivityContext(ctx.guild, text, ctx.user.id, ctx.channel.id);
  const response = activityReply(activityContext, text, ctx.user.id) || await askAI(ctx.user.id, text, {
    conversationId: conversationScope({ guildId: ctx.guild?.id, channelId: ctx.channel.id, userId: ctx.user.id }),
    context: `${serverContext}\n${activityContext}\nUsuario que pregunta: ${ctx.user.username} (${ctx.user.id}).\n\nContexto reciente del canal:\n${recent.join("\n")}`,
  });
  void sendLog("respuesta", { usuario: ctx.user.username, respuesta: response });
  await ctx.reply(response);
}

async function handleError(ctx, error) {
  console.error("Error ejecutando comando:", error.message);
  void sendLog("error", { usuario: ctx.user.username, error: error.cause?.message || error.message || String(error) });
  if (error.code === 10062 || error.code === 10015) return;
  const response = ['AI_BUDGET', 'ACTIVITY_PERIOD', 'AI_RESET'].includes(error.code) ? error.message : error.code === "AI_UNAVAILABLE"
    ? "Los proveedores de IA están saturados o alcanzaron su cuota gratuita. Prueba de nuevo más tarde."
    : error.code === "AI_BUSY"
    ? "Tengo varias consultas pendientes. Prueba de nuevo en un momento."
    : error.code === "AI_CONFIG"
    ? "Falta configurar el acceso a la IA. Avísale a Tom."
    : "Hubo un error. Intenta de nuevo.";
  try { await ctx.reply(response); }
  catch (replyError) { console.error("No se pudo enviar el error:", replyError.message); }
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.isRepliable()) return;
  if (!commands.some(command => command.name === interaction.commandName)) return;
  const ephemeral = ["reset", "ayuda"].includes(interaction.commandName) ||
    interaction.commandName === 'tars' && auditRequested(interaction.options.getString('mensaje') || '');
  const ctx = {
    user: interaction.user, guild: interaction.guild, channel: interaction.channel, messageId: interaction.id,
    reply: async text => {
      for (const chunk of splitResponse(text)) {
        const payload = { content: chunk, ...(ephemeral ? { flags: 64 } : {}), allowedMentions: { parse: [], repliedUser: false } };
        if (interaction.replied) await interaction.followUp(payload);
        else if (interaction.deferred) await interaction.editReply(payload);
        else await interaction.reply(payload);
      }
    },
  };
  return sendLog.withContext(ctx, async () => {
  try {
    await interaction.deferReply(ephemeral ? { flags: 64 } : {});
    void sendLog("slash", { usuario: ctx.user.username, comando: interaction.commandName, canal: ctx.channel?.name || "privado" });
    const argument = interaction.commandName === 'borrar' ? `${interaction.options.getUser('usuario') ? `<@${interaction.options.getUser('usuario').id}> ` : ''}${interaction.options.getInteger('cantidad')}` :
      interaction.commandName === "resumir" ? interaction.options.getInteger("cantidad") :
      interaction.commandName === "usuarios" ? interaction.options.getString("rol") :
      interaction.commandName === "tars" ? interaction.options.getString("mensaje") : null;
    await execute(ctx, interaction.commandName, argument);
  } catch (error) { await handleError(ctx, error); }
  });
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (message.guild) await activity.message(message).catch(activityError);
  channelContext.add(message.channel.id, message.author.id, `${message.author.username}: ${message.content}`);
  const match = message.content.trim().match(/^!(tars|reset|ping|ayuda|resumir|usuarios|borrar)(?:\s+([\s\S]*))?$/i);
  const ctx = {
    user: message.author, guild: message.guild, channel: message.channel, messageId: message.id,
    reply: async text => {
      for (const chunk of splitResponse(text)) {
        await message.reply({ content: chunk, allowedMentions: { parse: [], repliedUser: false } });
      }
    },
  };
  ctx.privateReply = async text => {
    if (!ctx.guild) return ctx.reply(text);
    try {
      for (const chunk of splitResponse(text)) await message.author.send({ content: chunk, allowedMentions: { parse: [] } });
    } catch { return ctx.reply('No pude enviarte la consulta en privado. Activa tus mensajes directos o usa /tars.'); }
  };
  return sendLog.withContext(ctx, async () => {
  try {
    if (await confirmDelete(ctx, message.content, { sendLog, clearContext: id => channelContext.delete(id) })) return;
    if (!match) return;
    if (["tars", "resumir", "usuarios"].includes(match[1].toLowerCase())) await message.channel.sendTyping();
    await execute(ctx, match[1].toLowerCase(), match[2]);
  } catch (error) { await handleError(ctx, error); }
  });
});

process.on("unhandledRejection", error => {
  console.error("Error no manejado:", error?.message || String(error));
  void sendLog("error_fatal", { error: error?.message || String(error) });
});
client.on("error", error => {
  console.error("Error del cliente Discord:", error.message);
  void sendLog("error_fatal", { error: error.message });
});

keepAlive(undefined, { ready: () => client.isReady() && Date.now() - health.activity < 120000 && Date.now() - health.mutes < 15000 && Date.now() - health.budget < 120000 });
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("Error al conectar con Discord:", error.message);
  process.exit(1);
});
