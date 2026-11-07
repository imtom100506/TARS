const { setTimeout: sleep } = require('node:timers/promises');
const { withAIRetry } = require('./aiRetry');
const { responseLimit, compactResponse } = require('./responsePolicy');
const { BoundedMap } = require('./boundedMap');

const unavailable = () => Object.assign(new Error('Los proveedores de IA no están disponibles.'), { code: 'AI_UNAVAILABLE' });
const clip = (text, max) => text.length <= max ? text : `${text.slice(0, max / 2)}\n[Contenido recortado]\n${text.slice(-max / 2)}`;

function retryAfter(value, now) {
  if (!value) return 60000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(1000, delay) : 60000;
}

function createAI({ systemPrompt, env = process.env, fetchImpl = global.fetch,
  wait = sleep, now = Date.now, spacingMs = 10000, maxHistories = 500 } = {}) {
  const histories = new BoundedMap(maxHistories);
  // Only pending work lives outside the bounded history cache (at most eight turns).
  const turns = new Set(), conversationQueues = new Map();
  const providers = [];
  if (env.GROQ_API_KEY) providers.push({
    name: 'Groq', key: env.GROQ_API_KEY,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-120b', blockedUntil: 0, nextRequest: 0,
  });
  if (env.CLOUDFLARE_API_TOKEN && /^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '')) providers.push({
    name: 'Cloudflare', key: env.CLOUDFLARE_API_TOKEN,
    url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
    model: '@cf/google/gemma-4-26b-a4b-it', blockedUntil: 0, nextRequest: 0,
  });
  let queue = Promise.resolve();
  let pending = 0;
  let budget;

  async function request(provider, messages, signal) {
    signal?.throwIfAborted();
    if (provider.nextRequest > now()) await wait(provider.nextRequest - now(), undefined, { signal });
    signal?.throwIfAborted();
    provider.nextRequest = now() + spacingMs;
    const body = { model: provider.model, messages, stream: false };
    if (provider.name === 'Groq') Object.assign(body, {
      max_completion_tokens: 2048, reasoning_effort: 'low', include_reasoning: false,
    });
    else body.max_tokens = 1024;
    const reservation = budget ? await budget.reserve({ tokens: Buffer.byteLength(JSON.stringify(messages), 'utf8') + (body.max_completion_tokens || body.max_tokens) }) : undefined;
    signal?.throwIfAborted();
    try {
      const response = await fetchImpl(provider.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      // Leer el cuerpo dentro del mismo manejo de errores y timeout.
      const data = await response.json();
      if (response.ok && data.success !== false) await reservation?.settle?.(data.usage?.total_tokens);
      if (!response.ok || data.success === false) {
        const status = response.ok ? 503 : response.status;
        if (status === 429) provider.blockedUntil = now() + retryAfter(response.headers.get('retry-after'), now());
        // No registrar cuerpos ni cabeceras que puedan contener datos privados.
        throw Object.assign(new Error(`${provider.name}: HTTP ${status}`), { status });
      }
      const choice = data.choices?.[0];
      const text = choice?.message?.content?.trim();
      if (!text || choice.finish_reason === 'length') {
        throw Object.assign(new Error(`${provider.name}: respuesta vacía o incompleta`), { status: 503 });
      }
      return text;
    } catch (error) {
      signal?.throwIfAborted();
      if (error.status) throw error;
      // Fallos de red, JSON inválido y timeout son recuperables.
      throw Object.assign(new Error(`${provider.name}: fallo de conexión o respuesta`), { status: 503 });
    }
  }

  async function generate(messages, signal, onProviderFailure) {
    if (!providers.length) throw Object.assign(new Error('Faltan credenciales de IA.'), { code: 'AI_CONFIG' });
    for (const provider of providers) {
      if (provider.blockedUntil > now()) continue;
      try {
        return await withAIRetry(() => request(provider, messages, signal), { wait });
      } catch (error) {
        signal?.throwIfAborted();
        if (error.code === 'AI_BUDGET' || error.cause?.code === 'AI_BUDGET') throw error.cause || error;
        const status = error.cause?.status || error.status;
        if (status !== 429) provider.blockedUntil = now() + ([400, 401, 403, 404].includes(status) ? 300000 : 30000);
        onProviderFailure?.({ proveedor: provider.name, codigo: status || 'conexion', resultado: 'buscando respaldo' });
        console.warn(`[IA] ${provider.name} no disponible (${status || 'conexión'}); buscando respaldo.`);
      }
    }
    throw unavailable();
  }

  function askAI(userId, userMessage, { context = '', conversationId, brief = false, signal, onProviderFailure } = {}) {
    const logBalance = () => {
      if (budget?.logStatus) budget.logStatus();
      else console.info('[IA:saldo]', JSON.stringify({ alcance: 'limite_interno_24h', tokens_restantes: null, estado: 'sin_registro' }));
    };
    if (pending >= 8) {
      logBalance();
      return Promise.reject(Object.assign(new Error('Cola de IA llena.'), { code: 'AI_BUSY' }));
    }
    pending++;
    const key = JSON.stringify([userId, conversationId ?? 'default:text']);
    const current = { userId, cleared: false };
    turns.add(current);
    const enqueued = now();
    // Serialize writes so concurrent replies preserve completed turns.
    const dependencies = [queue, conversationQueues.get(key)];
    const task = Promise.all(dependencies).then(async () => {
      signal?.throwIfAborted();
      if (current.cleared) throw Object.assign(new Error('La conversación se reinició antes de procesar esta consulta.'), { code: 'AI_RESET' });
      if (now() - enqueued > 90000) throw Object.assign(new Error('La cola de IA tardó demasiado.'), { code: 'AI_BUSY' });
      const history = histories.get(key)?.messages || [];
      const input = clip(String(userMessage), 6000);
      const limit = brief ? 600 : responseLimit(input);
      const messages = [{ role: 'system', content: `${systemPrompt}\nResponde a saludos y charla casual de forma natural y breve. Solo menciona estadísticas o actividad del servidor si la pregunta actual las solicita; no retomes reportes del historial ante un saludo.\nLímite de esta respuesta: ${limit} caracteres. Termina tus frases dentro de ese espacio.` }, ...history];
      messages.push({ role: 'user', content: context ? `Contexto del servidor:\n${clip(context, 12000)}\n\nPregunta: ${input}` : input });
      const generated = await generate(messages, signal, onProviderFailure);
      const reply = compactResponse(generated, limit);
      // No restaurar memoria si el usuario la borró mientras esperaba la respuesta.
      if (!current.cleared) {
        const updated = [...history, { role: 'user', content: input }, { role: 'assistant', content: reply }];
        let characters = updated.reduce((sum, msg) => sum + msg.content.length, 0);
        while (updated.length > 8 || characters > 4000) {
          characters -= updated[0].content.length + updated[1].content.length;
          updated.splice(0, 2);
        }
        histories.set(key, { userId, messages: updated });
      }
      return reply;
    }).finally(() => { turns.delete(current); logBalance(); });
    const next = task.catch(() => {}).finally(() => {
      pending--;
      if (conversationQueues.get(key) === next) conversationQueues.delete(key);
    });
    queue = next;
    conversationQueues.set(key, next);
    return task;
  }

  function clearHistory(userId) {
    for (const [key, history] of histories) if (history.userId === userId) histories.delete(key);
    // Includes queued requests as well as active requests.
    for (const turn of turns) if (turn.userId === userId) turn.cleared = true;
  }
  return { askAI, clearHistory, setBudget: value => { budget = value; } };
}

module.exports = { createAI, retryAfter };
