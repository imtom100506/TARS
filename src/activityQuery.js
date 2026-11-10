const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function isActivityQuestion(question) {
  const q = normalize(question);
  return isVoiceEndQuestion(question) || /\bactividad\b/.test(q) ||
    /\b(voz|llamada|conexiones|conect\w*|mensajes)\b/.test(q) &&
    /\b(cuant|quien|tiempo|duracion|llev|veces|mas|hoy|ayer|anoche|histor|total|ranking|top)/.test(q);
}

function isVoiceEndQuestion(question) {
  const q = normalize(question);
  return /\b(?:hasta (?:que|cual) hora|a que hora|cuando)\b/.test(q) &&
    /\b(?:se quedaron|nos quedamos|me quede|quedaron|termin\w*|acab\w*|se fueron|se fue|desconect\w*)\b/.test(q) &&
    /\b(?:voz|llamada|anoche|ayer|quedaron|quedamos|quede)\b/.test(q);
}

module.exports = { isActivityQuestion, isVoiceEndQuestion, normalize };
