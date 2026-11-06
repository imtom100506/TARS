// Metric answers are rendered from counters, not rewritten or rounded by an LLM.
const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const { naturalActivity, asksAboutSelf } = require('./naturalActivity');
const { isActivityQuestion } = require('./activityQuery');
function duration(ms) {
  if (ms > 0 && ms < 1000) return 'menos de 1 s';
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : '', s || !seconds ? `${s} s` : ''].filter(Boolean).join(' ');
}
function activityReply(context, question, requesterId, { voice = false } = {}) {
  const q = normalize(question);
  const requested = isActivityQuestion(question);
  if (!requested || !context) return null;
  if (context.startsWith('Estadísticas de actividad no disponibles')) return context;
  let data;
  try { data = JSON.parse(context.split('\n').at(-1)); }
  catch { return null; }
  if (!data.cobertura || !data.hoy) return null;
  const stats = data.periodoConsultado || data.hoy;
  if (data.consultaHoraria) {
    const h = data.consultaHoraria;
    if (h.error) return h.error;
    const summary = `${h.etiqueta} (hora de Chile): registré ${stats.mensajes} mensajes, ${stats.conexiones} conexiones y ${duration(stats.vozMs)} en voz sumando personas.`;
    if (voice) return `${summary} Cobertura parcial.`;
    const rows = /por hora|cada hora|desglose/.test(q) ? (stats.horas || []).map(r => `${r.hora}: ${r.mensajes} mensajes; ${duration(r.vozMs)} en voz.`).join('\n') : '';
    return `${summary}${rows ? '\n' + rows : ''}\n${h.parcial ? 'El período incluye horas anteriores al inicio del registro por hora. ' : ''}Solo actividad observada; los intervalos sin registros no prueban inactividad. Desglose limitado a 24 horas con registros.`;
  }
  if (!/tiempo|duracion|horas?|minutos?|segundos?|cuanto llev|por dia|al dia|diari/.test(q)) {
    return naturalActivity(data, q, requesterId, voice);
  }
  const coverage = 'Esto es lo que he visto; puede faltar actividad anterior.';
  const unknown = data.cobertura.sesionesActualesConInicioDesconocido;
  const mentioned = [...question.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  const self = asksAboutSelf(q);
  const targets = stats.consultados.filter(u => mentioned.length ? mentioned.includes(u.id) : self ? u.id === requesterId :
    q.includes(normalize(u.usuario)));
  let detail, spokenDetail;
  if (mentioned.length || self || targets.length) {
    detail = targets.length ? targets.map(u => `${u.usuario}: ${u.conexiones} conexiones observadas, ${duration(u.vozMs)} en voz registrados y ${u.mensajes} mensajes registrados.`).join(' ') :
      'No tengo registros del usuario solicitado en ese período; eso no demuestra que no haya participado.';
    if (targets.length) spokenDetail = `${targets[0].usuario}: ${duration(targets[0].vozMs)} en voz, ${targets[0].conexiones} conexiones, ${targets[0].mensajes} mensajes registrados.`;
    else spokenDetail = detail;
  } else if (/por dia|al dia|diari/.test(q) && stats.ultimosDiasRegistrados) {
    detail = stats.ultimosDiasRegistrados.map(d => `${d.fecha}: ${d.conexiones} conexiones observadas, ${d.usuariosVoz} participantes en voz.`).join('\n') || 'Sin días registrados en ese período.';
    detail += ' Hasta 14 días con registros; los días ausentes no prueban inactividad.';
  } else if (/\b(quien|mas|ranking|top)\b/.test(q)) {
    const byText = /mensajes|texto|escri/.test(q), byConnections = /conexiones|veces/.test(q);
    const rows = byText ? stats.topTexto : byConnections ? stats.topConexiones : stats.topVoz;
    const metric = u => byText ? u.mensajes : byConnections ? u.conexiones : u.vozMs;
    const value = u => byText ? `${u.mensajes} mensajes` : byConnections ? `${u.conexiones} conexiones` : duration(u.vozMs);
    detail = rows.length ? `Primeros ${rows.length} por ${byText ? 'mensajes' : byConnections ? 'conexiones' : 'tiempo en voz'} registrado: ${rows.map(u => `${u.usuario}: ${value(u)}`).join('; ')}.` : 'Sin participantes registrados para ese ranking.';
    if (rows.length > 1 && metric(rows[0]) === metric(rows[1])) detail += ' Hay empate en el primer puesto según lo observado.';
    spokenDetail = rows.length ? `Mayor ${byText ? 'actividad escrita' : byConnections ? 'número de conexiones' : 'tiempo en voz'} observado: ${rows[0].usuario}, ${value(rows[0])}.${rows.length > 1 && metric(rows[0]) === metric(rows[1]) ? ' Con empate.' : ''}` : detail;
  } else {
    detail = `Ahora hay ${data.ahoraEnVoz} personas en voz. En el período registré ${stats.usuariosVoz} participantes, ${stats.conexiones} conexiones y ${duration(stats.vozMs)} acumulados entre todos (tiempo-persona, no duración de la llamada); ${stats.mensajes} mensajes de ${stats.autores} ${stats.autores === 1 ? 'autor' : 'autores'}.`;
  }
  if (voice) {
    const compact = `${data.ahoraEnVoz} en voz ahora; ${duration(stats.vozMs)} registrados sumando personas, ${stats.conexiones} conexiones, ${stats.mensajes} mensajes.`;
    const prefix = 'Por lo que he registrado: ';
    const suffix = unknown ? ' Inicio real de sesiones previas desconocido.' : '';
    const response = `${prefix}${spokenDetail || compact}${suffix}`;
    // The speech pipeline accepts 280 characters: never cut a figure or the coverage warning.
    return response.length <= 280 ? response : `${prefix}${compact}${suffix}`;
  }
  return `${detail} ${coverage}`;
}
module.exports = { activityReply, duration };
