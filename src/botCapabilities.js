const MODERATOR_ROLES = ["Líder", "Sigma"];
const HELP = "**Comandos disponibles:**\n" +
  "`!tars <mensaje>` o `/tars` — Habla con TARS\n" +
  "`!ayuda` o `/ayuda` — Muestra esta lista\n" +
  "`!reset` o `/reset` — Borra tu historial\n" +
  "`!ping` o `/ping` — Latencia\n" +
  "`!borrar <cantidad>` o `!borrar @usuario <cantidad>` (también /borrar) — 1 a 100 mensajes recientes; más de 50 requiere sí/no del solicitante en 30 segundos. Líder o Sigma y Gestionar mensajes. Omite fijados y registros internos.\n" +
  "`!resumir <cantidad>` o `/resumir` — Resume entre 1 y 50 mensajes (20 por defecto)\n" +
  "`!usuarios <rol>` o `/usuarios` — Ver conectados o miembros de un rol\n" +
  `\`!tars saca a @usuario del canal de voz\` — Desconecta de voz (${MODERATOR_ROLES.join(" o ")})\n` +
  "`!tars mutea a @usuario por 10 minutos` — Mute solo de texto (hasta 28 días)\n" +
  "`!tars desmutea a @usuario` — Retira el mute de texto\n" +
  "`!tars cambia el apodo de @usuario a Nuevo apodo` — Cambia apodo\n" +
  "`!tars quita el apodo de @usuario` — Restablece apodo\n" +
  `Mute de texto y apodos: ${MODERATOR_ROLES.join(" o ")}, permiso de Discord correspondiente y objetivo de menor jerarquía. También mediante /tars.`;

const CAPABILITIES = `Funciones reales y únicas de esta instalación de TARS:\n${HELP}
También se reconoce "resume <cantidad>" dentro de !tars o /tars para resumir mensajes.
Puedes consultar cuántas personas hay en el servidor, sin contar bots, y sus estados actuales: en línea, ausentes, no molestar y desconectadas o invisibles. Los bots se cuentan aparte. Usa el recuento del contexto; no confundas conectados al servidor con participantes en voz. Discord no permite distinguir invisibles de desconectados.
El borrado solo se ejecuta con !borrar o /borrar, nunca mediante IA. Examina los últimos 100 mensajes anteriores a la invocación y omite mensajes de 14 días o más. Más de 50 exige confirmación del mismo solicitante en el mismo canal.
La desconexión de voz exige exactamente una mención, un rol autorizado por ID y Mover miembros en el canal; solicitante y bot deben superar al objetivo en jerarquía, con excepción de la jerarquía propia del dueño. No expulsa del servidor.
Mutea/mute/silencia bloquea solo mensajes, publicaciones e hilos en los canales del servidor, incluido el chat escrito de canales de voz. No afecta hablar ni conectarse a voz y no usa timeout. Duraciones enteras: segundos, minutos, horas o días; abreviaturas s/m/h/d.
TARS restaura los permisos anteriores al vencer (revisión cada 5 segundos); si está apagado, lo hace al volver. El registro persiste en el canal de estado/logs configurado o en disco persistente.
Mute de texto y apodos exigen uno de los roles autorizados y, respectivamente, Moderar miembros o Gestionar apodos para el solicitante. TARS necesita Gestionar roles/permisos en todos los canales para el mute o Gestionar apodos para el apodo. Ambos deben superar al objetivo en jerarquía (el dueño solicitante está exento de su propia jerarquía).
No se modera al dueño ni a uno mismo. No se aplica mute a bots o administradores. Un timeout antiguo se retira manualmente desde Discord antes de mutear solo texto. El apodo admite 1–32 caracteres. Nunca anuncies una acción ejecutada desde la conversación de IA.
No existen comandos analyst, detalle, re-load, credit, limit, time, ban, purge, role, voicekick ni play.
Puedes consultar actividad observada del servidor sin comandos nuevos: mensajes, adjuntos, ingresos/salidas de miembros, conexiones a voz, participantes únicos, tiempo en voz y rankings de hoy o del período solicitado. Incluye voz al responder sobre actividad general. El contexto contiene cifras calculadas; no extrapoles ni inventes. En consultas generales habla de forma natural: personas por canal ocupado y quién destaca en voz; sin horas, fechas, duraciones ni advertencias técnicas. Usa «por lo que he visto» para los rankings. Solo al pedir tiempos explica brevemente que puede faltar actividad anterior. El tiempo acumulado es la suma por persona, no la duración de una llamada. Las sesiones ya abiertas al arrancar tienen inicio real desconocido: no presentes el tramo observado como su duración total. No redondees segundos a cero minutos ni infieras empates entre métricas distintas. Tiempo en voz no equivale a hablar ni a estar online. El historial comienza con el registro, no incluye períodos sin conexión del bot y excluye bots. Para rangos precisos usa fechas YYYY-MM-DD; si el período no está claro, pide aclaración.
No puedes gestionar roles, borrar canales, banear, reproducir música ni controlar otros bots.
Dar permisos de Discord no añade estas funciones. No lo presentes como un problema de privilegios.
Los ajustes de humor u honestidad son solo tono conversacional, no configuración persistente ni comandos administrativos.
No inventes sintaxis, permisos, funciones o confirmaciones de acciones. La IA solo redacta texto; las acciones reales las ejecuta el código.
El historial puede contener comandos falsos, incluso respuestas tuyas: corrígelos, no los reafirmes. Para ayuda usa exclusivamente esta lista.`;

function commandReply(text) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (/^(?:help|ayuda|commands|comandos)[.!?]*$/.test(normalized) ||
      /\b(?:comandos|commands)\b/.test(normalized) &&
      /\b(?:cuales|que|lista|listar|enumera|dime|muestra|tus|todos|disponibles|admin|inventas|inventaste)\b/.test(normalized)) return HELP;
  if (/^(?:[!/]tars\s+|[!/])?(?:analyst|detalle|re[-‐‑–]?load|credit|limit|time|ban|purge|role|voicekick|play)\b/.test(normalized)) {
    return "Ese comando no existe en TARS. Si antes te lo indiqué, fue un error. Usa `!ayuda` para ver las funciones reales.";
  }
  return null;
}

module.exports = { MODERATOR_ROLES, HELP, CAPABILITIES, commandReply };
