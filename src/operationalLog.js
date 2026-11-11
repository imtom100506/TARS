const { AsyncLocalStorage } = require('node:async_hooks');
const IDS = new Set(['servidor_id', 'canal_id', 'usuario_id', 'ejecutor_id', 'objetivo_id']);
const COUNTS = new Set(['cantidad', 'duracion_ms', 'solicitados', 'borrados']);
const TAGS = new Set(['accion', 'comando', 'codigo', 'resultado']);
const validId = value => typeof value === 'string' && /^\d{1,22}$/.test(value);
function metadata(key, value) {
  if (IDS.has(key)) return validId(value) || key === 'objetivo_id' && value === 'todos' ? value : null;
  if (COUNTS.has(key)) return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (TAGS.has(key)) return ['string', 'number'].includes(typeof value) && /^[a-z0-9_-]{1,48}$/i.test(String(value)) ? value : null;
  return null;
}
function codeBlocks(text) {
  const blocks = [];
  let chunk = '';
  for (const character of text) {
    // Split embedded fences without altering the literal logged text.
    if (chunk.length + character.length > 1900 || character === '`' && chunk.endsWith('``')) {
      blocks.push('```\n' + chunk + '\n```');
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) blocks.push('```\n' + chunk + '\n```');
  return blocks;
}
function createOperationalLog(client, env = process.env) {
  const context = new AsyncLocalStorage();
  let pending = 0;
  const log = async (type, data = {}) => {
    const ctx = context.getStore();
    // A DM must never reach a guild, even if an inner service supplies a guild ID.
    if (ctx && !ctx.guildId) return;
    const guildId = ctx?.guildId || data.servidor_id;
    if (!validId(guildId) || !/^[a-z][a-z0-9_]{0,63}$/i.test(type) || pending >= 50) return;
    let destinations;
    try { destinations = JSON.parse(env.TARS_LOG_CHANNELS || '{}'); } catch { return; }
    if (!destinations || typeof destinations !== 'object' || Array.isArray(destinations)) return;
    const channelId = destinations[guildId] || env.LOG_CHANNEL_ID;
    if (!validId(channelId)) return;
    pending++;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.guildId !== guildId || !channel.isTextBased() || !channel.send) return;
      const fields = Object.entries({ ...data, servidor_id: guildId }).map(([key, value]) => [key, metadata(key, value)])
        .filter(([, value]) => value !== null).map(([key, value]) => `${key}: ${value}`).join('\n');
      const content = type === 'mensaje'
        ? `user: ${data.usuario ?? ''}\nmessage: ${data.mensaje ?? ''}`
        : type === 'respuesta'
          ? `TARS's response to ${data.usuario ?? ''}: ${data.respuesta ?? ''}`
          : `${type}\n${fields}`;
      for (const block of codeBlocks(content)) {
        await channel.send({ content: block, allowedMentions: { parse: [] } });
      }
    } catch { console.warn('[log] No se pudo guardar metadata operacional.'); }
    finally { pending--; }
  };
  log.withContext = (ctx, fn) => context.run({ guildId: ctx?.guild?.id }, fn);
  return log;
}
module.exports = { createOperationalLog };
