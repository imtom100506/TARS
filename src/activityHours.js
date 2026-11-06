const { normalize } = require('./activityQuery');
const HOUR = 3600000;
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const hourLabel = time => formatter.format(new Date(time)).replace(' ', 'T');
const hourKey = time => Math.floor(time / HOUR) * HOUR;
const previous = date => new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

function hourlyQuery(question, from, to, today) {
  const q = normalize(question);
  if (/\banoche\b/.test(q)) {
    return { start: `${previous(today)}T20`, end: `${today}T06`, etiqueta: `Anoche, de ${previous(today)} 20:00 a ${today} 06:00` };
  }
  const range = q.match(/\b(?:entre(?: las)?|de(?: las)?|desde(?: las)?)\s+(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)?\s*(?:y|a|hasta)(?: las)?\s+(\d{1,2})(?::(\d{2}))?/);
  const single = q.match(/\ba las\s+(\d{1,2})(?::(\d{2}))?/);
  if (range || single) {
    const start = Number((range || single)[1]);
    const end = range ? Number(range[3]) : start + 1;
    if (start > 23 || end > 24 || end <= start || Number((range || single)[2] || 0) || Number(range?.[4] || 0)) {
      return { error: 'Pídeme horas completas en orden, por ejemplo «actividad ayer de 20:00 a 23:00». Para la noche que cruza medianoche puedes decir «anoche» (20:00–06:00).' };
    }
    if (from !== to) return { error: 'Para consultar una franja horaria, indica un solo día, por ejemplo «actividad ayer de 20 a 23».' };
    return { start: `${from}T${String(start).padStart(2, '0')}`, end: `${to}T${String(end).padStart(2, '0')}`,
      etiqueta: `${from}, ${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00` };
  }
  if (/por hora|cada hora|desglose horario/.test(q)) return { start: `${from}T00`, end: `${to}T24`, etiqueta: `Actividad por hora, ${from} a ${to}` };
  return null;
}

module.exports = { HOUR, hourKey, hourLabel, hourlyQuery };
