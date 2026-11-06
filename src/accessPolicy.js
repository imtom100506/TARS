const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
const configured = require('../config/moderation-roles.json');
function hasModeratorRole(member, guildId, env = process.env) {
  const override = env.TARS_MODERATOR_ROLE_IDS?.split(',').map(s => s.trim()).filter(Boolean);
  const ids = override?.length ? override : configured[guildId] || [];
  return ids.length > 0 && !!member?.roles?.cache?.some(role => ids.includes(role.id));
}
async function canReadAudit(guild, userId) {
  if (!userId) return false;
  const [member] = await Promise.all([guild.members.fetch({ user: userId, force: true }), guild.roles.fetch()]);
  return member.permissions.has(P.ViewAuditLog);
}
async function activityVisibility(guild, requesterId, responseChannelId) {
  if (!requesterId || !responseChannelId) return () => false;
  const [member, , channels, activeThreads, response] = await Promise.all([
    guild.members.fetch({ user: requesterId, force: true }), guild.roles.fetch(),
    guild.channels.fetch(), guild.channels.fetchActiveThreads(),
    guild.channels.fetch(responseChannelId, { force: true }),
  ]);
  const fresh = new Map([...channels, ...activeThreads.threads]);
  if (response) fresh.set(response.id, response);
  let privateResponseAllowed = false;
  if (response?.type === ChannelType.PrivateThread && response.permissionsFor(member)?.has(P.ViewChannel)) {
    privateResponseAllowed = !!response.permissionsFor(member)?.has(P.ManageThreads);
    if (!privateResponseAllowed) {
      try { privateResponseAllowed = !!await response.members.fetch({ member: requesterId, force: true }); }
      catch { /* A stale membership must never authorize private-thread history. */ }
    }
  }
  return candidate => {
    const channel = candidate && fresh.get(candidate.id);
    if (!channel || channel.guildId !== guild.id || !channel.permissionsFor(member)?.has(P.ViewChannel)) return false;
    if (channel.type === ChannelType.PrivateThread) return channel.id === responseChannelId && privateResponseAllowed;
    if (channel.id === responseChannelId) return true;
    // ThreadChannel.permissionsFor checks the parent, not private-thread membership.
    const audience = channel.isThread?.() ? fresh.get(channel.parentId) : channel;
    if (!audience?.permissionsFor(guild.id)?.has(P.ViewChannel)) return false;
    // @everyone may see a channel while a particular role/member is explicitly denied it.
    return !audience.permissionOverwrites?.cache?.some(overwrite => overwrite.deny.has(P.ViewChannel));
  };
}
module.exports = { hasModeratorRole, canReadAudit, activityVisibility };
