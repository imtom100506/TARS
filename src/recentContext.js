const { BoundedMap } = require('./boundedMap');
function createRecentContext() {
  const channels = new BoundedMap(200);
  return {
    add(channelId, userId, text) {
      channels.set(channelId, [...(channels.get(channelId) || []), { userId, text: text.slice(0, 500) }].slice(-15));
    },
    get(channelId) { return (channels.get(channelId) || []).map(row => row.text); },
    delete(channelId) { channels.delete(channelId); },
    clearUser(userId) {
      for (const [id, rows] of [...channels]) channels.set(id, rows.filter(row => row.userId !== userId));
    },
  };
}
module.exports = { createRecentContext };
