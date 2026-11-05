# TARS

Bot de Discord con conversación por texto y voz. Se despliega usando el Dockerfile
en Render; configura los secretos y opciones indicados en `.env.example`.
No necesita una computadora personal encendida. Una sola instancia por token.

`!entrar` / `/entrar`: di «Hey TARS» seguido de tu consulta. Después de cada respuesta
tienes 8 segundos para continuar sin repetir la frase, solo con el mismo interlocutor.
Sale tras 5 minutos de inactividad. También admite `/escuchar` y `/salir`.
No escucha mientras habla. Detecta hasta tres hablantes simultáneos, sin mezclar
sus voces; responde a una pregunta por vez. Las preguntas duran como máximo 12 segundos.

`!borrar 10` borra mensajes del canal; `!borrar @usuario 10` filtra por autor.
También existe `/borrar cantidad usuario`. Cantidades de 1 a 50 se ejecutan directamente;
de 51 a 100 requieren «sí» o «no» del solicitante en el mismo canal durante 30 segundos.
Exige rol Líder o Sigma y permiso Gestionar mensajes, además de Ver canal/Leer historial;
TARS también necesita esos permisos. Revisa los últimos 100 mensajes anteriores a la
invocación; omite fijados, registros internos y mensajes de 14 días o más. Al confirmar
revalida permisos y solo puede borrar los mensajes seleccionados originalmente.
Este comando no usa IA ni tokens. No se realizan borrados como parte de las pruebas.

La detección y voz Davefx española se ejecutan localmente en Render. Los modelos
se descargan y verifican al construir Docker. Groq transcribe las preguntas y
genera respuestas; Cloudflare es un respaldo opcional para el texto. No se guardan
grabaciones. Las preguntas ya transcritas y respuestas reproducidas se envían al
canal de texto `logs-tars` del mismo servidor, con autor, canal y hora. TARS necesita
Ver canal y Enviar mensajes allí. No se registra conversación de fondo ni se hacen
llamadas adicionales a IA para los registros. Si falla la transcripción no habrá
texto que registrar; si falla la respuesta, se conserva solo la pregunta. Avisa a
los participantes de este registro; sus textos quedan visibles para quienes tengan
acceso a `logs-tars`. El detector puede equivocarse con ruido
o acentos; `/escuchar` permite invocarlo manualmente.

## Consumo y diagnóstico

TARS recibe estadísticas de actividad al conversar por `!tars`, `/tars` o voz,
sin comandos adicionales y aunque la escucha de voz esté desactivada. Registra
conexiones a voz, participantes únicos, minutos en voz (no minutos hablando),
rankings por duración y conexiones, mensajes, adjuntos e ingresos/salidas de
miembros humanos en los servidores y canales cuyos eventos recibe. Los cambios
de canal o de mute no cuentan como otra conexión; se excluyen bots y mensajes privados.
No necesita entrar a los canales de voz ni grabar audio para medir presencia.

Las consultas de estadísticas reconocidas se responden directamente desde los
contadores, sin que la IA reescriba las cifras. Se conservan milisegundos y se
muestran horas, minutos y segundos sin redondear hacia arriba. Toda respuesta
indica el inicio del registro y la cobertura parcial. El acumulado entre personas
no es la duración de una llamada: cuatro personas observadas durante 15 segundos
suman un minuto de tiempo-persona. Si una sesión ya estaba abierta al arrancar,
TARS indica que desconoce su inicio real; no atribuye el tramo medido a todo el día.

Puedes preguntar «¿Cómo ha ido la actividad del servidor?», «¿Quién participa más
en voz hoy?», «¿Cuántas veces se ha conectado @usuario en el histórico?» o
«Actividad entre 2026-11-01 y 2026-11-05». Usa días de America/Santiago; admite
hoy, ayer, anteayer, últimos N días, esta semana, este mes e histórico. Los rankings
muestran los primeros tres; los desgloses diarios muestran hasta los últimos 14
días con registros del período. Los totales usan todo el período registrado.

Las cifras comienzan al activar esta versión: no reconstruyen actividad anterior
ni eventos perdidos mientras el bot está desconectado. Las sesiones abiertas al
arrancar se miden desde ese momento sin inventar una conexión. Guarda agregados
por servidor, usuario y día cada minuto y al apagarse; una caída abrupta puede
perder hasta el último intervalo sin guardar. No almacena contenido de mensajes
ni audio en este registro. Usa un archivo adjunto de estado separado en
`TARS_STATE_CHANNEL_ID` o `LOG_CHANNEL_ID`, protegido frente a `!borrar`; sin canal
configurado usa `TARS_DATA_DIR/server-activity.json` (requiere disco persistente).
Conserva el mensaje «TARS · Actividad del servidor · No borrar». Si falla la lectura,
no se sobrescribe y TARS avisa que las estadísticas no están disponibles.
El almacenamiento no tiene purga automática: el historial crece con los días y
usuarios activos y queda sujeto al límite de adjuntos de Discord.

Con voz habilitada, el registro privado de Discord conserva los límites internos:
500 intentos de API, 100.000 tokens estimados y 3.600 segundos de audio por 24 horas
móviles. Se permiten 20 transcripciones y 6 respuestas por minuto, separadamente;
configurables con TARS_STT_REQUESTS_PER_MINUTE y TARS_LLM_REQUESTS_PER_MINUTE.
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
El audio reserva al menos 10 segundos por llamada. No borres el registro de cuota.
Estos topes son preventivos; los límites reales de cada proveedor siguen aplicando.
Mantén las cuentas en el plan gratuito: el bot no modifica la facturación.

El filtro por energía descarta capturas sin señal suficiente antes de transcribir;
las capturas aceptadas se envían completas, sin recortar la voz. No es un detector
infalible de voz. Una continuación vacía no cierra la ventana
restante ni genera avisos. Durante una pausa de cuota no se capturan más preguntas.
Logs: `[voz:tiempos]` para latencia, `[voz:detector]` para recepción/detección y
`[voz:pausa]` para el motivo y tiempo restante de un límite interno.

## Desarrollo

Node 24. `npm ci`, `npm test`. Docker instala ffmpeg y eSpeak NG, además de los
modelos de voz. `TARS_WAKE_ENABLED=false` vuelve a la activación manual;
`TARS_TTS_ENGINE=espeak` usa la voz ligera. Render y los proveedores gratuitos
pueden suspender o limitar el servicio; no se garantiza disponibilidad permanente.

La carga neural tiene hasta 45 segundos en segundo plano. Durante la carga se usa
la voz ligera, pasando a la voz neural cuando está lista. La síntesis neural sigue
limitada a 15 segundos por respuesta. Un paquete Opus inválido aislado se descarta
sin perder el resto de la recepción; cinco inválidos consecutivos reportan error.
`[voz:captura]` y `[voz:audio]` distinguen capturas vacías, errores y falta de señal;
`[voz:error]` indica la etapa que falló, sin registrar conversaciones.
`[voz:entrada]` mide preparación, conexión, carga del detector y tiempo total de entrada.
Las comprobaciones de programas se ejecutan en paralelo y se reutilizan durante el
despliegue; se solapan con la conexión. El saludo solo se envía cuando TARS está listo.

Referencia de límites: https://console.groq.com/docs/rate-limits

## Restauración selectiva

La recepción, síntesis y registros de voz, junto al emisor de logs de Discord,
usarán la implementación del 10/10/2026 (996b3d0). Los comandos escritos, borrado
con confirmación, permisos y moderación se conservan. Se mantienen las mejoras
compartidas de IA posteriores: colas independientes para texto y voz, cancelación
de esperas, procesamiento SSE y presupuestos configurables con recuperación precisa.
No se activa la escucha global, la voz Ald ni el nuevo formato de logs.

### Dos órdenes locales de voz

Se reincorporan salida ("TARS, salte del canal", "TARS, desconéctate") y
autodestrucción de broma ("TARS, autodestrucción"). Se conserva la activación
manual /escuchar o Hey TARS; durante respuestas y cuenta regresiva se reciben
órdenes prioritarias del mismo canal. No se activa escucha global en reposo.
La cuenta reproduce 5, 4, 3, 2, 1 con un WAV de cinco segundos generado con la voz
Davefx y ajustes existentes. No sintetiza ni consulta al modelo al ejecutarla.
Repetir la orden no reinicia el plazo; una salida normal desconecta inmediatamente.
Las negaciones no activan estas órdenes. El audio fallido no cancela la salida.
Se registran inicio y desconexión usando el emisor y formato de logs existentes.
