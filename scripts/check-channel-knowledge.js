// Read-only REST smoke check: no Gateway login, messages sent, or LLM requests.
require('dotenv').config();
const { Client, ClientUser, Routes } = require('discord.js');
const { createChannelKnowledge, SOURCES } = require('../src/channelKnowledge');
async function main() {
  if (!process.env.DISCORD_TOKEN) throw Error('Falta DISCORD_TOKEN.');
  const client = new Client({ intents: [], rest: { timeout: 15000 } });
  client.rest.setToken(process.env.DISCORD_TOKEN);
  try {
    client.user = new ClientUser(client, await client.rest.get(Routes.user()));
    for (const [name, id] of Object.entries(SOURCES)) {
      const raw = await client.rest.get(Routes.channel(id));
      const guild = await client.guilds.fetch(raw.guild_id);
      const result = await createChannelKnowledge({ maxThreads: 3, maxPages: 1 }).read(guild,
        name === 'noticias' ? 'noticias de hoy' : 'cursos de biblioteca',
        { requesterId: client.user.id, responseChannelId: id });
      // Only status lines are logged; never message bodies or credentials.
      console.log(JSON.stringify({ source: name, type: raw.type, retrieved: !!result.context,
        status: result.context ? result.context.split('\n')[1] : result.reply }));
    }
  } finally { await client.destroy(); }
}
main().catch(() => { console.error('Falló la comprobación de lectura de Discord.'); process.exitCode = 1; });
