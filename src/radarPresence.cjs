// Conexión opcional y permanente a Discord; las publicaciones siguen en Cloudflare.
// Requiere discord.js v14 en el host. No habilita intents privilegiados.
const { Client, Events, ActivityType } = require('discord.js');

function startRadarPresence({ token = process.env.RADAR_DISCORD_TOKEN, logger = console, ClientClass = Client } = {}) {
  if (!token) {
    logger.info('[RADAR] Presencia desactivada: falta RADAR_DISCORD_TOKEN.');
    return null;
  }
  const client = new ClientClass({
    intents: [],
    allowedMentions: { parse: [] },
    presence: {
      status: 'online', afk: false,
      activities: [{ name: 'Noticias y recursos · horario Chile', type: ActivityType.Watching }]
    }
  });
  client.once(Events.ClientReady, () => logger.info('[RADAR] Conectado a Discord.'));
  client.on(Events.Error, () => logger.warn('[RADAR] Error de conexión; revisa el estado del servicio.'));
  client.on(Events.ShardReconnecting, () => logger.info('[RADAR] Reconectando a Discord.'));
  void client.login(token).catch(() => logger.error('[RADAR] No se pudo iniciar sesión. Revisa el token y la conexión.'));
  return { client, stop: () => client.destroy() };
}

module.exports = { startRadarPresence };

if (require.main === module) {
  const radar = startRadarPresence();
  if (!radar) process.exitCode = 1;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { radar?.stop(); process.exit(0); });
  }
}
