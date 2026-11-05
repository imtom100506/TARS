const { AuditLogEvent: A, PermissionFlagsBits: P } = require('discord.js');
const { day, period } = require('./serverActivity');
const clean = text => String(text || '').replace(/[\r\n]/g, ' ').slice(0, 180);
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function auditRequested(text) {
  const q = normalize(text);
  if (/\b(comandos|commands|ayuda|help)\b/.test(q)) return false;
  if (/\b(quien|cuando)\b.*\b(?:se )?conecto(?: al| a| en)|\bquienes\b.*\bconectaron\b/.test(q)) return true;
  return /auditoria/.test(q) || /\b(quien|que|cuando|muestra|dime|consulta|resume|ver|hubo|registro|ultim\w*)\b/.test(q) &&
    /ban\w*|kick\w*|expuls\w*|mute\w*|timeout|silenci\w*|ensord\w*|encord\w*|movio|movieron|movimientos|desconecto|desconexiones|entro|entradas|salio|salidas/.test(q);
}
function createServerAudit({ activity, now = Date.now, maxPages = 10 }) {
  let sequence = 0;
  const pending = new Map();
  const user = (g, id) => g.members.cache.get(id)?.displayName || id || 'alguien no identificado';
  const channel = (g, id) => g.channels?.cache.get(id)?.name || id || 'un canal no identificado';
  function record(entry, guild) {
    const extra = entry.extra || {};
    return activity.recordEvent(guild.id, {
      id: `audit:${entry.id}`, source: 'audit', at: entry.createdTimestamp,
      action: entry.action, actorId: entry.executorId || null, actor: clean(entry.executor?.username),
      targetId: entry.targetId || null, target: clean(entry.target?.username),
      channelId: extra.channel?.id || extra.channel_id || null, count: Number(extra.count) || 1,
      changes: (entry.changes || []).filter(c => ['mute', 'deaf', 'communication_disabled_until'].includes(c.key))
        .map(c => ({ key: c.key, old: c.old ?? null, new: c.new ?? null })),
    });
  }
  async function voice(oldState, newState) {
    const changes = [];
    if (oldState.channelId !== newState.channelId) changes.push({
      kind: !oldState.channelId ? 'join' : !newState.channelId ? 'leave' : 'move',
      from: oldState.channelId, to: newState.channelId,
    });
    for (const field of ['serverMute', 'serverDeaf', 'selfMute', 'selfDeaf']) {
      if (typeof oldState[field] === 'boolean' && typeof newState[field] === 'boolean' && oldState[field] !== newState[field]) {
        changes.push({ kind: field, value: newState[field], from: oldState.channelId, to: newState.channelId });
      }
    }
    for (const change of changes) await activity.recordEvent(newState.guild.id, {
      id: `voice:${now()}:${++sequence}:${newState.id}`, source: 'voice', at: now(), targetId: newState.id, ...change,
    });
  }
  async function refresh(g) {
    if (pending.has(g.id)) return pending.get(g.id);
    const task = (async () => {
      const me = g.members.me || await g.members.fetchMe();
      if (!me.permissions.has(P.ViewAuditLog)) return 'Me falta el permiso Ver registro de auditoría para consultar las acciones de moderación.';
      let before;
      for (let page = 0; page < maxPages; page++) {
        const { entries } = await g.fetchAuditLogs({ limit: 100, ...(before ? { before } : {}) });
        for (const entry of entries.values()) await record(entry, g);
        if (entries.size < 100) return '';
        const last = entries.last();
        if (last.createdTimestamp < now() - 45 * 86400000) return '';
        if (before === last.id) break;
        before = last.id;
      }
      return 'Revisé las entradas más recientes; puede haber más acciones antiguas sin consultar.';
    })().catch(() => 'No pude actualizar la auditoría de Discord; solo puedo mostrar lo que tenía guardado.')
      .finally(() => pending.delete(g.id));
    pending.set(g.id, task);
    return task;
  }
  function describe(e, g) {
    const who = user(g, e.targetId), actor = e.actor || user(g, e.actorId);
    if (e.source === 'voice') {
      if (e.kind === 'join') return `${who} entró a ${channel(g, e.to)}.`;
      if (e.kind === 'leave') return `${who} salió de ${channel(g, e.from)}.`;
      if (e.kind === 'move') return `${who} pasó de ${channel(g, e.from)} a ${channel(g, e.to)}; ese cambio por sí solo no indica quién lo movió.`;
      const self = e.kind.startsWith('self'), deaf = e.kind.endsWith('Deaf');
      return `${who}: ${e.value ? 'activó' : 'desactivó'} ${deaf ? 'el ensordecimiento' : 'el silencio'} ${self ? 'propio' : 'del servidor (autor no identificado en este evento)'}.`;
    }
    const target = e.target || who;
    if (e.action === A.MemberBanAdd) return `${actor} baneó a ${target}.`;
    if (e.action === A.MemberBanRemove) return `${actor} quitó el baneo de ${target}.`;
    if (e.action === A.MemberKick) return `${actor} expulsó a ${target} del servidor.`;
    if (e.action === A.MemberMove) return `${actor} movió a ${e.targetId ? target : `${e.count} miembro(s)`} a ${channel(g, e.channelId)}.${e.targetId ? '' : ' Discord no identifica a cuáles en esa entrada.'}`;
    if (e.action === A.MemberDisconnect) return `${actor} desconectó de voz a ${e.targetId ? target : `${e.count} miembro(s)`}.${e.targetId ? '' : ' Discord no identifica a cuáles en esa entrada.'}`;
    if (e.action === A.MemberUpdate && e.changes.length) return e.changes.map(c => {
      if (c.key === 'communication_disabled_until') return `${actor} ${c.new ? 'aplicó' : 'retiró'} un timeout a ${target}.`;
      return `${actor} ${c.new ? 'activó' : 'retiró'} ${c.key === 'mute' ? 'el silencio' : 'el ensordecimiento'} de servidor de ${target}.`;
    }).join(' ');
    return `${actor}: ${A[e.action] || 'acción de auditoría'}${e.targetId ? ` sobre ${target}` : ''}.`;
  }
  async function reply(g, question, { voice: spoken = false } = {}) {
    if (!auditRequested(question)) return null;
    if (!g) return 'Pídeme la auditoría dentro del servidor que quieres consultar.';
    const status = await refresh(g);
    const q = normalize(question);
    let from, to;
    try {
      [from, to] = period(/hoy|ayer|semana|mes|dias|\d{4}-\d{2}-\d{2}/.test(q) ? question : 'histórico', day(now()));
    } catch { return 'Dime un rango de fechas válido para buscar en el registro.'; }
    const mentions = [...question.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
    if (!mentions.length) {
      for (const [id, member] of g.members.cache) {
        if ([member.displayName, member.user?.username].some(name => name && name.length > 2 && q.includes(normalize(name)))) mentions.push(id);
      }
    }
    let rows = (await activity.events(g.id)).filter(e => day(e.at) >= from && day(e.at) <= to);
    const matches = e => {
      if (/ban/.test(q)) return [A.MemberBanAdd, A.MemberBanRemove].includes(e.action);
      if (/kick|expuls/.test(q)) return e.action === A.MemberKick;
      if (/mute|silenci|ensord|encord|timeout/.test(q)) return e.source === 'voice' ? /Mute|Deaf/.test(e.kind) : e.action === A.MemberUpdate && e.changes.length;
      if (/movio|movieron|movimientos/.test(q)) return e.action === A.MemberMove || e.kind === 'move';
      if (/desconect/.test(q)) return e.action === A.MemberDisconnect || e.kind === 'leave';
      if (/entro|entradas|conecto|conectaron/.test(q)) return e.kind === 'join';
      if (/salio|salidas/.test(q)) return e.kind === 'leave';
      return true;
    };
    rows = rows.filter(matches).filter(e => !mentions.length || mentions.includes(e.targetId) || mentions.includes(e.actorId) ||
      (!e.targetId && [A.MemberMove, A.MemberDisconnect].includes(e.action)));
    rows.sort((a, b) => b.at - a.at);
    if (spoken) {
      if (status) return status;
      const first = rows[0] && describe(rows[0], g);
      return first && first.length <= 280 ? first : rows.length ? 'Encontré varias acciones. Pídemelas por el chat para mostrarte el detalle.' : 'No encuentro acciones de ese tipo en lo que tengo registrado.';
    }
    return [status, rows.length ? 'Lo más reciente que encontré:\n' + rows.slice(0, 8).map(e => describe(e, g)).join('\n') :
      'No encuentro acciones de ese tipo en lo que tengo registrado.', rows.length > 8 ? 'Te muestro las últimas ocho coincidencias.' : ''].filter(Boolean).join('\n');
  }
  return { record, voice, reply, refresh };
}
module.exports = { createServerAudit, auditRequested };
