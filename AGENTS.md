# Preferencias del usuario

- Tras publicar los cambios para un despliegue solicitado, dejar la comprobación
  posterior al usuario. No abrir Render, consultar sus logs, comprobar endpoints
  de salud ni seguir CI después de publicar, salvo que el usuario lo pida.
- El usuario revisará Render y comunicará si está todo correcto. Ahorrar tokens
  y evitar informes o instrucciones de prueba después del despliegue.
- Cuando el despliegue esté confirmado, responder solo: «Ya está desplegado».
  Si únicamente se confirmó el envío que inicia el despliegue automático,
  responder: «Cambios publicados; despliegue automático iniciado».
  No afirmar que terminó ni que fue verificado si no hay evidencia de ello.
- Esta preferencia no elimina las comprobaciones necesarias antes de publicar.
