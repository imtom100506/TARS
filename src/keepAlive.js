const { createServer } = require("node:http");

function keepAlive(port = process.env.PORT || 3000, { ready = () => false } = {}) {
  const server = createServer((req, res) => {
    const route = req.url.split("?")[0];
    const found = ['/', '/live', '/ready'].includes(route) && ["GET", "HEAD"].includes(req.method);
    let available = false;
    try { available = ready() === true; } catch { /* Fail closed. */ }
    const status = !found ? 404 : route === '/ready' && !available ? 503 : 200;
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(!found ? "No encontrado" : route === '/ready' ? available ? 'Listo' : 'No disponible' : "TARS activo");
  });
  server.on("error", error => console.error("Error del servidor HTTP:", error.message));
  server.listen(Number(port));
  return server;
}

module.exports = keepAlive;
