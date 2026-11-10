# Changelog de TARS

## 2026-11-10

- Consultas bajo demanda de noticias y cursos en sus foros configurados, con
  publicaciones activas/archivadas, embeds de bots, fechas de Chile y enlaces.
- Separación de «resume las noticias» respecto del resumen del chat actual;
  validación de permisos y avisos explícitos de lecturas parciales o fallidas.
- Reconocimiento de «hasta qué hora se quedaron anoche», con respuesta desde
  los eventos de voz guardados, sin inventar la hora de término de una llamada.
- Prueba REST de solo lectura: `node scripts/check-channel-knowledge.js`.

## 2026-10-10

- Comando sin IA `!borrar cantidad` / `!borrar @usuario cantidad`, también `/borrar`:
  hasta 50 mensajes directamente; de 51 a 100 con confirmación del solicitante en 30 segundos.
- Borrado restringido a Líder y Sigma con Gestionar mensajes. Protege fijados y registros
  internos, omite mensajes antiguos y revalida permisos y selección al confirmar.

## 2026-10-09

### Consumo

- Reservas de tokens ajustadas al consumo real informado por el proveedor;
  se conserva la estimación cuando ese dato no está disponible.
### Registros y mantenimiento

- Saldo interno de tokens en `[IA:saldo]` después de cada consulta de IA, incluidos
  errores y bloqueos. `[IA:limite]` identifica el límite alcanzado y su recuperación.
- Guías de configuración consolidadas en un README breve.
## 2026-10-08

### Funciones

- Mute de texto temporal y comando para retirarlo.
- Cambio y restablecimiento de apodos.
- Recuperación de mutes y vencimientos después de reinicios y despliegues.
- Controles de roles, permisos y jerarquía para moderación.

### Respuestas y ayuda

- Respuestas más cortas: hasta 600 caracteres, o 1.500 al pedir detalle.
- Ayuda basada en los comandos implementados y corrección de comandos ficticios.
- Identificación del usuario actual en el contexto de conversación.

### Mantenimiento

- Exclusión de dependencias instaladas del seguimiento de Git.
- Servidor HTTP ligero con las herramientas integradas de Node.js.
- Memoria de conversaciones acotada y reutilización de las entradas recientes.
- Menos actualizaciones repetidas de permisos y escrituras del registro de mutes.
- Limpieza de mensajes de diagnóstico redundantes y actualización de la configuración de ejemplo.
- Pruebas de regresión de IA, comandos, moderación y persistencia.
