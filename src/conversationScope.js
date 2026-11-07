// Scope names are structured to avoid collisions and private-to-public history reuse.
function conversationScope({ guildId, channelId, userId }) {
  if (!userId || !channelId) throw new Error('Falta el usuario o canal de la conversación.');
  return JSON.stringify([guildId || 'dm', channelId, userId]);
}
module.exports = { conversationScope };
