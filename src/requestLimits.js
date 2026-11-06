const { BoundedMap } = require('./boundedMap');
function createRequestLimits({ now = Date.now, userLimit = 6, guildLimit = 30 } = {}) {
  const users = new BoundedMap(2000), guilds = new BoundedMap(200);
  return (userId, guildId = 'dm') => {
    const time = now();
    const user = (users.get(userId) || []).filter(t => time - t < 60000);
    const guild = (guilds.get(guildId) || []).filter(t => time - t < 60000);
    if (user.length >= userLimit || guild.length >= guildLimit) return false;
    users.set(userId, [...user, time]); guilds.set(guildId, [...guild, time]);
    return true;
  };
}
module.exports = { createRequestLimits };
