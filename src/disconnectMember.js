const { PermissionFlagsBits: P } = require('discord.js');
const { hasModeratorRole } = require('./accessPolicy');
const { mentionedUserId } = require('./commandUtils');
async function disconnectMember(ctx, text, sendLog) {
  const guild = ctx.guild;
  const actor = await guild.members.fetch({ user: ctx.user.id, force: true });
  const owner = ctx.user.id === guild.ownerId;
  if (!owner && !hasModeratorRole(actor, guild.id)) return ctx.reply('Negativo. No tienes rango suficiente para ordenarme eso.');
  const id = mentionedUserId(text);
  if (!id) return ctx.reply('Menciona exactamente a un usuario. Ej: `!tars saca a @usuario del canal de voz`');
  const target = await guild.members.fetch({ user: id, force: true }).catch(error => { if (error.code === 10007) return null; throw error; });
  if (!target) return ctx.reply('No encontré a ese usuario en el servidor.');
  if (id === ctx.user.id || id === guild.ownerId || (!owner && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0)) {
    return ctx.reply('No puedo desconectar a ese usuario: revisa la jerarquía de roles.');
  }
  if (!target.voice.channelId) return ctx.reply(`${target.user.username} no está en ningún canal de voz.`);
  const channel = await guild.channels.fetch(target.voice.channelId, { force: true });
  const me = await guild.members.fetchMe({ force: true });
  if (!channel?.permissionsFor(actor)?.has(P.MoveMembers)) return ctx.reply('Necesitas el permiso Mover miembros en ese canal.');
  if (!channel.permissionsFor(me)?.has(P.MoveMembers) || !target.manageable) return ctx.reply('Me faltan permisos o jerarquía para desconectar a ese usuario.');
  await target.voice.disconnect(`Solicitado por ${ctx.user.id}`);
  void sendLog('desconexion', { servidor_id: guild.id, ejecutor_id: ctx.user.id, objetivo_id: id, canal_id: channel.id });
  return ctx.reply(`${target.user.username} desconectado del canal de voz.`);
}
module.exports = { disconnectMember };
