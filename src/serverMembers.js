const { normalize } = require('./activityQuery');

function isMemberCountQuestion(question) {
  const q = normalize(question);
  if (/\b(voz|llamada|mensajes|actividad|ayer|hoy|tiempo|ranking|histor\w*)\b/.test(q)) return false;
  return /\b(cuant\w*|cantidad|numero|total|estadisticas|recuento)\b/.test(q) &&
    /\b(gente|personas|usuarios|miembros|humanos|bots|conectados|desconectados|online|offline|ausentes)\b/.test(q);
}

function createServerMembers({ now = Date.now, ttl = 60000 } = {}) {
  const snapshots = new WeakMap();
  async function read(guild) {
    if (!guild) return null;
    const previous = snapshots.get(guild);
    if (previous && now() - previous.at < ttl) return previous.promise;
    const entry = { at: now() };
    entry.promise = (async () => {
      try {
        if (guild.available === false) return null;
        const members = await guild.members.fetch({ withPresences: true, time: 15000 });
        if (members.size !== guild.memberCount) return null;
        const counts = { humans: 0, bots: 0, online: 0, idle: 0, dnd: 0, offline: 0 };
        for (const member of members.values()) {
          if (member.user.bot) { counts.bots++; continue; }
          counts.humans++;
          const status = member.presence?.status || 'offline';
          if (!['online', 'idle', 'dnd', 'offline'].includes(status)) return null;
          counts[status]++;
        }
        return counts;
      } catch { return null; }
    })();
    snapshots.set(guild, entry);
    return entry.promise;
  }
  async function reply(guild) {
    if (!guild) return 'Consulta el recuento dentro del servidor; por mensaje privado no tengo un servidor seleccionado.';
    const c = await read(guild);
    if (!c) return 'No pude obtener el recuento completo de miembros y estados de Discord. Prueba de nuevo en un minuto.';
    return `Hay **${c.humans} personas** (sin bots): **${c.online + c.idle + c.dnd} conectadas** ` +
      `(${c.online} en línea, ${c.idle} ausentes y ${c.dnd} en no molestar) y **${c.offline} desconectadas o invisibles**. ` +
      `Bots aparte: **${c.bots}**. Recuento consultado hace menos de un minuto.`;
  }
  async function context(guild) {
    if (!guild) return 'Conversación por mensaje privado. No hay un servidor seleccionado para consultar miembros.';
    return `Recuento del servidor ${JSON.stringify(guild.name)}: ${await reply(guild)} ` +
      'Usa estas cifras para preguntas sobre miembros y presencia actual, no las del historial. ' +
      'Conectados incluye en línea, ausente y no molestar. Discord no distingue invisibles de desconectados. ' +
      'Presencia no equivale a estar en voz. Si la consulta falló, no inventes cifras. No menciones el recuento salvo que sea relevante.';
  }
  return { read, reply, context };
}

module.exports = { createServerMembers, isMemberCountQuestion };
