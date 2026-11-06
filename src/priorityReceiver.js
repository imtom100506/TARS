// Modo manual: durante respuestas solo se transcriben intervenciones para controles.
// Solo el interlocutor activo puede interrumpir; nunca se transcribe a otros miembros.
function priorityReceiver({ s, api, decoderFactory, audio, onText, onError, setTimer, clearTimer, client, allowRequest = () => true }) {
  const active = new Map();
  const eligible = id => !s.closed && !s.capturing && (s.busy || s.countdown) &&
    id === (s.countdown ? s.controlUser : s.activeUser) &&
    id !== client.user.id && s.voiceChannel.members.has(id) && !s.voiceChannel.members.get(id).user.bot;
  function start(id) {
    if (!eligible(id) || active.has(id) || active.size >= 3) return;
    const previous = s.connection.receiver.subscriptions?.get(id);
    if (previous?.destroyed) return;
    if (!allowRequest(id, s.voiceChannel.guild.id)) return;
    const input = s.connection.receiver.subscribe(id, { end: { behavior: api.EndBehaviorType.AfterSilence, duration: 500 } });
    const decoder = decoderFactory();
    let bytes = 0, chunks = [], done = false, timer;
    const abort = new AbortController();
    const cleanup = () => { clearTimer(timer); input.unpipe(decoder); input.destroy(); decoder.destroy(); };
    const forget = () => { if (active.get(id) === cancel) active.delete(id); };
    const cancel = () => { done = true; abort.abort(); cleanup(); chunks = []; forget(); };
    active.set(id, cancel);
    function finish() {
      if (done) return;
      done = true; cleanup();
      const pcm = Buffer.concat(chunks, bytes); chunks = [];
      const signal = AbortSignal.any([s.abort.signal, abort.signal]);
      Promise.resolve().then(() => !signal.aborted && eligible(id) ? audio.transcribe(pcm, signal) : '').then(text => {
        if (!signal.aborted && eligible(id)) onText(text, id);
      }).catch(error => { if (!signal.aborted) onError(error); }).finally(forget);
    }
    input.on('error', cancel); decoder.on('error', cancel);
    decoder.on('end', finish);
    decoder.on('data', chunk => {
      if (done) return;
      if (!eligible(id)) { cancel(); return; }
      const kept = chunk.subarray(0, 384000 - bytes); chunks.push(kept); bytes += kept.length;
      if (bytes >= 384000) finish();
    });
    timer = setTimer(finish, 12000); timer?.unref?.(); input.pipe(decoder);
  }
  s.connection.receiver.speaking.on('start', start);
  const pause = () => { for (const cancel of [...active.values()]) cancel(); };
  return { pause, stop() { s.connection.receiver.speaking.removeListener('start', start); pause(); } };
}
module.exports = { priorityReceiver };
