const { hourLabel } = require('./activityHours');
const { normalize } = require('./activityQuery');

function voiceEndObservation({ events, sessions, guild, question, requesterId, visible, from, to, hourly, now }) {
  if (hourly?.error) return { error: hourly.error };
  const start = hourly?.start || `${from}T00`, end = hourly?.end || `${to}T24`;
  const q = normalize(question);
  const ids = [...q.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  if (!ids.length && /\b(?:me quede|me desconecte)\b/.test(q)) ids.push(requesterId);
  if (!ids.length) for (const [id, m] of guild.members.cache) {
    if ([m.displayName, m.user?.username].some(n => n?.length > 2 && q.includes(normalize(n)))) ids.push(id);
  }
  const matches = (id, channelId) => (!ids.length || ids.includes(id)) && visible(channelId);
  const within = at => hourLabel(at) >= start && hourLabel(at) < end && at <= now;
  const rows = events.filter(e => e.source === 'voice' && e.bot !== true &&
    !guild.members.cache.get(e.targetId)?.user?.bot && ['join', 'leave', 'move'].includes(e.kind) && within(e.at) &&
    matches(e.targetId, e.kind === 'leave' ? e.from : e.to));
  for (const s of sessions) {
    if (s.guildId === guild.id && matches(s.userId, s.channelId) && within(now)) rows.push({ at: now, kind: 'active', targetId: s.userId });
  }
  rows.sort((a, b) => b.at - a.at);
  const last = rows[0];
  return { start, end, last: last ? { at: last.at, kind: last.kind } : null };
}

function voiceEndReply(data) {
  if (data.error) return data.error;
  const range = `${data.start.replace('T', ' ')}:00–${data.end.replace('T', ' ')}:00 (Chile)`;
  if (!data.last) return `No encontré eventos de voz para ${range}; no puedo estimar a qué hora se quedaron sin inventarlo. Puede faltar actividad anterior o de cuando estuve desconectado.`;
  const stamp = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(data.last.at));
  const detail = data.last.kind === 'leave' ? `La última salida de voz que registré fue el ${stamp}` :
    `Todavía observé gente en voz el ${stamp}; no tengo una salida posterior confirmada en ese período`;
  return `${detail}. Consulté ${range}. Es lo observado, no una garantía de que toda la llamada terminara ahí; puede haber huecos en el registro.`;
}
module.exports = { voiceEndObservation, voiceEndReply };
