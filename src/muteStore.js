const MARKER = "TARS · Registro de mutes de texto · No borrar";
const FILE_NAME = "tars-text-mutes.json";

// Un mensaje del propio bot guarda el registro. No requiere disco de pago en Render.
function createDiscordMuteStore(client, channelId, fetchImpl = global.fetch, marker = MARKER, fileName = FILE_NAME) {
  let channel, message, lastSaved, located = false, initialized = false;
  async function locate() {
    if (located) return;
    channel = await client.channels.fetch(channelId);
    if (!channel?.messages || !channel.isTextBased()) throw new Error("El canal de estado de mutes debe ser de texto");
    message = undefined;
    let before;
    while (true) {
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      message = [...batch.values()].find(item => item.author.id === client.user.id && item.content === marker);
      if (message || batch.size < 100) break;
      before = batch.last().id;
    }
    located = true;
  }
  async function read() {
    initialized = false;
    await locate();
    if (!message) { initialized = true; return null; }
    const attachment = [...message.attachments.values()].find(item => item.name === fileName);
    if (!attachment) throw new Error("Falta el archivo del registro de mutes; no se sobrescribirá");
    const response = await fetchImpl(attachment.url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("No se pudo leer el registro de mutes de Discord");
    lastSaved = await response.text();
    initialized = true;
    return lastSaved;
  }
  async function recoverDeleted(payload) {
    // Only the caller's already-loaded current state is authoritative. Never
    // invent an empty replacement or overwrite another instance's new record.
    located = false;
    message = undefined;
    await locate();
    if (message) {
      initialized = false;
      throw new Error("El registro fue reemplazado; vuelve a leerlo antes de guardar");
    }
    message = await channel.send(payload);
  }
  async function write(data) {
    if (!initialized) throw new Error("Debe leerse correctamente el registro antes de guardarlo");
    await locate();
    const payload = { content: marker, attachments: [],
      files: [{ attachment: Buffer.from(data, "utf8"), name: fileName }], allowedMentions: { parse: [] } };
    try {
      if (message && data === lastSaved) {
        // A cache hit is not evidence the remote backup still exists.
        await channel.messages.fetch({ message: message.id, force: true, cache: false });
        return;
      }
      if (message) message = await message.edit(payload);
      else message = await channel.send(payload);
    } catch (error) {
      if (error.code !== 10008) throw error;
      await recoverDeleted(payload);
    }
    lastSaved = data;
  }
  return { read, write };
}

module.exports = { createDiscordMuteStore, MARKER };
