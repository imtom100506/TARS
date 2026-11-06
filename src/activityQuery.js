const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function isActivityQuestion(question) {
  const q = normalize(question);
  return /\bactividad\b/.test(q) ||
    /\b(voz|llamada|conexiones|conect\w*|mensajes)\b/.test(q) &&
    /\b(cuant|quien|tiempo|duracion|llev|veces|mas|hoy|ayer|anoche|histor|total|ranking|top)/.test(q);
}

module.exports = { isActivityQuestion, normalize };
