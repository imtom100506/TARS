function naturalActivity(data, q, requesterId, voice) {
  const s = data.periodoConsultado || data.hoy, sentences = [];
  const mentions = [...q.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  const self = /\b(yo|mi|mis|he)\b/.test(q);
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const targets = s.consultados.filter(u => mentions.length ? mentions.includes(u.id) : self ? u.id === requesterId : q.includes(normalize(u.usuario)));
  const leader = () => {
    const first = s.topVoz[0];
    if (!first?.vozMs) return 'Todavía no tengo suficiente actividad para destacar a alguien en voz.';
    if (s.lideresVoz > 1 || s.topVoz[1]?.vozMs === first.vozMs) return 'Por lo que he visto, varios van empatados como los más activos en voz.';
    return `Por lo que he visto${data.periodoConsultado ? ' en ese período' : ' hoy'}, ${first.usuario} es quien más ha estado en voz.`;
  };
  if (mentions.length || self || targets.length) {
    for (const u of targets) sentences.push(`He visto a ${u.usuario} conectarse ${u.conexiones} ${u.conexiones === 1 ? 'vez' : 'veces'} a voz y enviar ${u.mensajes} ${u.mensajes === 1 ? 'mensaje' : 'mensajes'}.`);
    if (!targets.length) sentences.push('No tengo actividad registrada de esa persona para lo que me preguntas.');
  } else if (/\b(quien|mas|ranking|top)\b/.test(q)) {
    const text = /mensajes|texto|escri/.test(q), connections = /conexiones|veces/.test(q);
    const rows = text ? s.topTexto : connections ? s.topConexiones : null;
    if (!rows) sentences.push(leader());
    else {
      const field = text ? 'mensajes' : 'conexiones';
      if (!rows.length) sentences.push('Todavía no he visto suficiente actividad para destacar a alguien.');
      else if (rows[1]?.[field] === rows[0][field]) sentences.push(`Por lo que he visto, hay empate entre quienes más ${text ? 'han escrito' : 'se han conectado'}.`);
      else sentences.push(`${rows[0].usuario} es quien más ${text ? 'ha escrito' : 'se ha conectado'}: he contado ${rows[0][field]} ${field}.`);
    }
  } else if (/conexiones|veces/.test(q)) {
    sentences.push(`He contado ${s.conexiones} conexiones de ${s.usuariosVoz} personas en el período que preguntas.`);
  } else {
    if (data.periodoConsultado) sentences.push(`En ese período vi a ${s.usuariosVoz} personas participar en voz.`);
    else if (data.canalesVoz?.length) {
      for (const c of data.canalesVoz) sentences.push(`Hay ${c.personas} ${c.personas === 1 ? 'persona' : 'personas'} en ${c.nombre}.`);
    } else sentences.push(data.ahoraEnVoz ? `Hay ${data.ahoraEnVoz} personas en voz ahora.` : 'Ahora mismo no hay nadie en los canales de voz.');
    sentences.push(leader());
    if (s.topTexto[0]?.mensajes) sentences.push(`Por el chat, ${s.topTexto[0].usuario} también ha estado participando.`);
  }
  if (!voice) return sentences.join(' ');
  let spoken = '';
  for (const sentence of sentences) {
    if ((spoken + ' ' + sentence).trim().length > 280) break;
    spoken = (spoken + ' ' + sentence).trim();
  }
  return spoken || 'Tengo el detalle de la actividad; pídemelo por el chat para verlo completo.';
}
module.exports = { naturalActivity };
