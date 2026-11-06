// Scope names are structured to avoid collisions and private-to-public history reuse.
function conversationScope({ guildId, channelId, userId, modality = 'text' }) {
  if (!userId || !channelId) throw new Error('Falta el usuario o canal de la conversación.');
  return JSON.stringify([guildId || 'dm', channelId, userId, modality]);
}
module.exports = { conversationScope };
