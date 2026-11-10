# TARS

Asistente de Discord con IA, resúmenes, estadísticas de actividad y moderación para la comunidad.

Repositorio: [imtom100506/TARS](https://github.com/imtom100506/TARS).
El paquete npm se llama `tars`. Se despliega usando el Dockerfile
en Render; configura los secretos y opciones indicados en `.env.example`.
No necesita una computadora personal encendida. Una sola instancia por token.

Al conectarse, muestra una actividad de tipo Observando: «Ayudando a la comunidad».
Al iniciar también sincroniza la descripción de su aplicación en Discord:
«Conversación, resúmenes y moderación para la comunidad.»
Reinicia o redespliega el bot para aplicar estos cambios.

`!borrar 10` borra mensajes del canal; `!borrar @usuario 10` filtra por autor.
También existe `/borrar cantidad usuario`. Cantidades de 1 a 50 se ejecutan directamente;
de 51 a 100 requieren «sí» o «no» del solicitante en el mismo canal durante 30 segundos.
Exige rol Líder o Sigma y permiso Gestionar mensajes, además de Ver canal/Leer historial;
TARS también necesita esos permisos. Revisa los últimos 100 mensajes anteriores a la
invocación; omite fijados, registros internos y mensajes de 14 días o más. Al confirmar
revalida permisos y solo puede borrar los mensajes seleccionados originalmente.
Este comando no usa IA ni tokens. No se realizan borrados como parte de las pruebas.

Groq genera las respuestas; Cloudflare es un respaldo opcional.

## Consumo y diagnóstico

`!tars noticias relevantes de hoy` y `/tars` consultan el foro de noticias
`1568787404339290202`. `!tars qué cursos hay de Python en biblioteca` consulta
`1501665090792063067`. También admite «resume las noticias» y consultas de ambos
foros. Lee mensajes, títulos, descripciones y campos de embeds, incluidos bots;
cita los mensajes originales. Los adjuntos se identifican, pero no se descargan
ni se leen páginas externas. Sin fecha, noticias usa hoy en America/Santiago y
biblioteca busca publicaciones recientes sin restringirse a hoy. Admite días y
rangos YYYY-MM-DD; la fecha corresponde a la publicación en Discord.

Recorre hilos activos y hasta dos páginas de 100 archivados por foro, selecciona
hasta 20 hilos por tema/actividad y lee hasta 200 mensajes por hilo (o canal de
texto). Entrega hasta ocho publicaciones a la IA y solicita tres resultados con
fuentes. Avisa de límites y errores; no promete búsqueda exhaustiva. Estas
consultas no guardan contenido ni respuestas en la memoria conversacional.
Solicitante y bot necesitan Ver canal y Leer historial. Solo muestra contenido
público o del canal de origen de la consulta, siguiendo las restricciones de
audiencia de actividad. La lectura se hace cuando se pregunta, no periódicamente.

`!tars hasta qué hora se quedaron anoche aprox?` ahora consulta los eventos de voz
guardados y responde directamente con la última salida o presencia observada,
con fecha y hora de Chile. Usa la franja habitual 20:00–06:00; respeta canales
visibles y menciones. No confunde la suma de minutos de varias personas con el
fin de una llamada. Si faltan eventos, lo dice; no reconstruye noches sin registro.
Reinicia o redespliega TARS para activar estas funciones.

TARS puede responder `!tars cuánta gente hay en el server` o la misma pregunta en `/tars`.
Consulta todos los miembros con sus presencias: personas sin bots, conectadas
(en línea, ausentes y no molestar), desconectadas o invisibles y bots por separado.
Discord no distingue invisibles de desconectados. Reutiliza el recuento durante
60 segundos y comparte consultas simultáneas; si falla o está incompleto, avisa
sin presentar la caché parcial como un total. Las preguntas de recuento se contestan
sin IA; las demás conversaciones reciben estos datos como contexto para seguimientos.
En Discord Developer Portal → Bot deben estar habilitados **Server Members Intent**
y **Presence Intent**, además de **Message Content Intent** para los comandos de texto.
El código ya solicita los tres. Reinicia o redespliega TARS tras actualizarlo.

TARS recibe estadísticas históricas solo cuando la pregunta actual solicita actividad por `!tars` o `/tars`;
los saludos y la charla casual reciben respuestas naturales sin reportes automáticos. Registra actividad
sin comandos adicionales. Registra
conexiones a voz, participantes únicos, minutos en voz (no minutos hablando),
rankings por duración y conexiones, mensajes, adjuntos e ingresos/salidas de
miembros humanos en los servidores y canales cuyos eventos recibe. Los cambios
de canal o de mute no cuentan como otra conexión; se excluyen bots y mensajes privados.
No necesita entrar a los canales de voz ni grabar audio para medir presencia.

Las consultas de estadísticas reconocidas se responden directamente desde los
contadores, sin que la IA reescriba las cifras. La respuesta habitual es conversacional:
cuántas personas hay en cada canal ocupado y quién destaca en voz, sin fechas,
horas, duraciones ni avisos técnicos. Los empates se reconocen, sin inventar un ganador.
Solo si se pregunta por tiempo se muestran horas, minutos y segundos y se aclara
que puede faltar actividad anterior. Se conservan milisegundos en los contadores.
El tiempo sumado entre personas no es la duración de una sola llamada.

TARS también consulta auditoría cuando se pregunta por baneos, expulsiones, mutes,
ensordecimientos, timeouts o movimientos. Tanto TARS como el solicitante necesitan
**Ver registro de auditoría**. `/tars` entrega estas consultas de forma efímera;
`!tars` las envía por mensaje privado.
Usa el intent GuildModeration y una caché de 30 segundos. La primera lectura
revisa hasta 1.000 entradas; las siguientes se detienen al alcanzar el historial
conocido, releyendo siempre la última página para detectar acciones agrupadas.
Cada usuario puede consultar una vez cada 10 segundos. Avisa si alcanzó el límite o falló la
lectura. Discord conserva su auditoría 45 días. No se prometen períodos anteriores.
Las consultas muestran hasta ocho coincidencias; no ejecutan moderación.

Las entradas/salidas y cambios de canal normales se registran con eventos de voz.
Un cambio observado no prueba quién lo causó: solo se atribuye un autor cuando
consta en auditoría, y no se vinculan movimientos grupales a usuarios por proximidad
de tiempo. Distingue silencio/ensordecimiento propio de los impuestos por el servidor.
Los eventos se guardan junto al estado de actividad, hasta 5.000 por servidor y
45 días. Los contadores diarios y horarios se conservan 365 días por defecto,
configurables con `TARS_ACTIVITY_RETENTION_DAYS` (1 a 3650).

Puedes preguntar «¿Cómo ha ido la actividad del servidor?», «¿Quién participa más
en voz hoy?», «¿Cuántas veces se ha conectado @usuario en el histórico?» o
«Actividad entre 2026-11-01 y 2026-11-05». Usa días de America/Santiago; admite
hoy, ayer, anteayer, últimos N días, esta semana, este mes e histórico. Los rankings
muestran los primeros tres; los desgloses diarios muestran hasta los últimos 14
días con registros del período. Los totales usan todo el período registrado.

También admite «actividad hoy por hora», «actividad ayer de 20:00 a 23:00»,
«actividad 2026-11-05 a las 21» y «¿cómo estuvo la actividad anoche?».
Las franjas usan horas completas, inicio incluido y fin excluido. «Anoche» significa
20:00 del día anterior a 06:00 de hoy, siempre en America/Santiago, y se indica
explícitamente al responder. El desglose muestra hasta las últimas 24 horas con
registros del período; el total incluye toda la franja. Las horas repetidas por
cambio de horario se guardan separadas (con inicio UTC) aunque compartan etiqueta local.
El detalle horario empieza al desplegar esta versión: los totales diarios anteriores
se conservan, pero no se reparten artificialmente entre horas. Las consultas se
responden en el canal donde se hacen; no se envían informes periódicos automáticamente.

Las cifras comienzan al activar esta versión: no reconstruyen actividad anterior
ni eventos perdidos mientras el bot está desconectado. Las sesiones abiertas al
arrancar se miden desde ese momento sin inventar una conexión. Guarda agregados
por servidor, usuario, día y hora cada minuto y al apagarse; una caída abrupta puede
perder hasta el último intervalo sin guardar. No almacena contenido de mensajes
ni audio en este registro. Usa un archivo adjunto de estado separado en
`TARS_STATE_CHANNEL_ID` o `LOG_CHANNEL_ID`, protegido frente a `!borrar`; sin canal
configurado usa `TARS_DATA_DIR/server-activity.json` (requiere disco persistente).
Conserva el mensaje «TARS · Actividad del servidor · No borrar». Si falla la lectura,
no se sobrescribe y TARS avisa que las estadísticas no están disponibles.
La purga se aplica al cargar, consultar y guardar. El tamaño sigue sujeto al límite
de adjuntos de Discord. Si alguien borra el mensaje mientras TARS está conectado,
se reconstruye desde su estado ya cargado; una lectura fallida nunca se sustituye
por un registro vacío. No es un respaldo frente a la pérdida del registro y del proceso a la vez.

Las respuestas de actividad incluyen canales públicos y el propio canal donde se
consulta, siempre que el solicitante pueda verlos. No exponen canales privados a
otras audiencias. Los nuevos agregados conservan el canal de origen; los totales
antiguos sin esa información no se usan para construir respuestas públicas.
Un período ambiguo pide aclaración en lugar de asumir que significa hoy.

El registro privado de Discord conserva los límites internos
(sin canal configurado, usa `TARS_DATA_DIR/usage.json`):
500 intentos de API y 100.000 tokens estimados por 24 horas móviles.
Se permiten 6 respuestas por minuto, configurables con TARS_LLM_REQUESTS_PER_MINUTE.
Cada intento se guarda antes de llamar al proveedor; los fallos también cuentan.
Cuando el proveedor informa `usage.total_tokens`, la reserva de tokens se ajusta
al consumo real. Sin ese dato se conserva la estimación. Los registros antiguos
no se rebajan porque no hay evidencia de su consumo real. `[IA:limite]` muestra
el tope alcanzado, uso, reserva solicitada y fecha UTC de recuperación.
Después de cada consulta de IA, `[IA:saldo]` muestra `tokens_restantes`,
`tokens_contabilizados` y `limite_tokens` del límite interno de 24 horas móviles.
Incluye errores y bloqueos. Usa el consumo real si está disponible y reservas
conservadoras en los demás casos. No es el saldo de la cuenta Groq; `null` indica
que el registro no está disponible o todavía no se ha cargado.
No borres el registro de cuota.
Estos topes son preventivos; los límites reales de cada proveedor siguen aplicando.
Mantén las cuentas en el plan gratuito: el bot no modifica la facturación.

## Desarrollo

Node 24.22.2 o revisión posterior de Node 24; `.node-version` fija la versión probada.
`npm ci`, `npm run check`, `npm run test:coverage`, `npm audit --omit=dev`.
El contenedor instala las dependencias de texto. Render y los proveedores gratuitos
pueden suspender o limitar el servicio; no se garantiza disponibilidad permanente.

## Privacidad, permisos y disponibilidad

La memoria conversacional se separa por servidor, canal y usuario.
`reset` invalida también turnos pendientes y retira las intervenciones del usuario
del contexto reciente en memoria. No elimina mensajes de Discord ni registros persistidos.
Los logs operacionales no contienen preguntas, respuestas ni mensajes privados.
`TARS_LOG_CHANNELS` permite un mapa JSON servidor→canal; cada destino debe pertenecer
al mismo servidor.

Los roles de moderación se autorizan por ID en `config/moderation-roles.json`, con
los IDs existentes de Líder y Sigma. `TARS_MODERATOR_ROLE_IDS` puede reemplazarlos
con una lista separada por comas. Revisa esa configuración si recreas los roles.
Desconectar requiere además Mover miembros en el canal y jerarquía válida para el
solicitante y TARS. El dueño conserva su excepción de rol y jerarquía propia.

Las consultas de texto tienen límites previos a las operaciones costosas: 6 solicitudes por
usuario y 30 por servidor por minuto, además del presupuesto persistente del proveedor.

`/live` comprueba que el proceso HTTP responde. `/ready` devuelve 503 hasta que
Discord esté conectado y se hayan validado actividad, recuperación de mutes y cuota;
también deja de estar listo si las revisiones fallan o caducan. Docker lo usa para
su healthcheck y prepara `/app/data` escribible por el usuario sin privilegios.
Para persistencia local, monta un volumen en esa ruta. CI ejecuta las pruebas,
audita dependencias y construye el contenedor con una prueba de carga de módulos
y escritura sin red ni credenciales.

## Presencia opcional de RADAR

Configura RADAR_DISCORD_TOKEN como secreto en Render para conectar el bot RADAR en el mismo proceso. No requiere intents privilegiados ni otra instancia de hosting. Si falta esa variable, TARS funciona como siempre y la presencia de RADAR queda desactivada. Las publicaciones de RADAR siguen ejecutándose en Cloudflare. El estado en línea dura mientras el servicio esté activo; el plan gratuito y el monitor externo no garantizan disponibilidad ininterrumpida.
