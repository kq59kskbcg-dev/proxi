import Anthropic from '@anthropic-ai/sdk';
import { redact } from '../lib/redact.js';
import { rateLimit } from '../lib/ratelimit.js';
import { requireUser } from '../lib/auth.js';
import { getLangfuse, getSystemPrompt } from '../lib/langfuse.js';
import { CONVERSATION_ID, hasDatabase, saveConversation } from '../lib/db.js';

// Only these models can be requested from the browser.
const MODELS = {
  'Opus 5.5': 'claude-opus-5-5',
  'Sonnet 5.5': 'claude-sonnet-5-5',
  'Haiku 5.5': 'claude-haiku-5-5',
};
// Opus and Sonnet support server-side refusal fallbacks; Haiku does not.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const MAX_TOKENS = 8000; // cost cap per reply
const MAX_MESSAGES = 40; // most recent messages sent to the model
const MAX_HISTORY = 200; // messages kept in a saved chat
const MAX_CHARS = 20000;

let client;

export async function POST(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error }, user.status);

  const limit = rateLimit(user.userId);
  if (!limit.ok) {
    return json({ error: 'Too many messages. Please wait a few minutes.' }, 429, { 'Retry-After': String(limit.retryAfter) });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const model = MODELS[body?.model];
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const valid = raw.length > 0 && raw[0].role === 'user' && raw.every((m) =>
    (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0 && m.content.length <= MAX_CHARS);
  if (!model || !valid) return json({ error: 'Invalid request.' }, 400);
  if (raw.length > MAX_HISTORY) return json({ error: 'This chat is too long. Please start a new one.' }, 400);
  const conversationId = typeof body.conversationId === 'string' && CONVERSATION_ID.test(body.conversationId) ? body.conversationId : null;

  // Redact every message, including earlier ones, before the model or logs see them.
  const redactions = {};
  const history = raw.map((m) => {
    const { text, counts } = redact(m.content);
    for (const [k, v] of Object.entries(counts)) redactions[k] = (redactions[k] || 0) + v;
    return { role: m.role, content: text, model: label(m.model), traceId: label(m.traceId) };
  });
  // The model sees the most recent messages, starting from a user message.
  let recent = history.slice(-MAX_MESSAGES);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  const messages = recent.map((m) => ({ role: m.role, content: m.content }));

  const system = await getSystemPrompt();
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'chat',
    userId: user.userId,
    sessionId: conversationId ?? undefined,
    input: messages,
    metadata: { redactions },
  });
  const generation = trace?.generation({
    name: 'reply', model, input: [{ role: 'system', content: system.text }, ...messages], prompt: system.prompt,
  });

  const params = {
    model,
    max_tokens: MAX_TOKENS,
    system: system.text,
    output_config: { effort: 'low' }, // chat rarely needs deep thinking; keeps replies fast and cheap
    messages,
  };
  client ??= new Anthropic();
  const stream = FALLBACK_MODELS.has(model)
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: request.signal })
    : client.messages.stream(params, { signal: request.signal });

  const encoder = new TextEncoder();
  const body$ = new ReadableStream({
    async start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      send({ type: 'start', traceId: trace?.id ?? null, redactions });
      let text = '';
      let servedBy = model;
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            text += event.delta.text;
            send({ type: 'text', text: event.delta.text });
          }
        }
        const final = await stream.finalMessage();
        servedBy = final.model;
        if (final.stop_reason === 'refusal') {
          send({ type: 'error', error: "Proxi can't help with that request." });
        }
        generation?.end({
          output: text,
          usageDetails: { input: final.usage.input_tokens, output: final.usage.output_tokens },
          metadata: { stopReason: final.stop_reason, servedBy: final.model },
        });
        trace?.update({ output: text });
        send({ type: 'done', stopReason: final.stop_reason, model: final.model });
      } catch (error) {
        if (request.signal.aborted) {
          generation?.end({ output: text, level: 'WARNING', statusMessage: 'Stopped by user' });
        } else {
          generation?.end({ output: text, level: 'ERROR', statusMessage: errorName(error) });
          send({ type: 'error', error: userMessage(error) });
        }
      } finally {
        // Save the chat (already redacted), including a partial reply if it was stopped.
        if (conversationId && hasDatabase()) {
          const reply = text ? [{ role: 'assistant', content: text, model: servedBy, traceId: trace?.id ?? null }] : [];
          await saveConversation(user.userId, conversationId, titleFrom(history), [...history, ...reply])
            .catch((e) => console.error('saving chat failed', e));
        }
        await langfuse?.flushAsync().catch(() => {});
        try { controller.close(); } catch {}
      }
    },
    cancel() { stream.abort(); },
  });

  return new Response(body$, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function titleFrom(history) {
  const first = history.find((m) => m.role === 'user')?.content.trim().replace(/\s+/g, ' ') || 'New chat';
  return first.length > 60 ? first.slice(0, 60).trim() + '...' : first;
}

// Optional per-message labels sent back by the page (which model answered, trace ID).
function label(value) {
  return typeof value === 'string' && value.length <= 80 ? value : null;
}

function userMessage(error) {
  if (error instanceof Anthropic.RateLimitError) return 'Proxi is busy right now. Please try again in a minute.';
  if (error instanceof Anthropic.AuthenticationError) return 'Proxi is not set up correctly. Please try again later.';
  if (error instanceof Anthropic.BadRequestError) return 'That message could not be sent. Try a shorter message.';
  return 'Something went wrong. Please try again.';
}

function errorName(error) {
  return error instanceof Anthropic.APIError ? `${error.constructor.name} ${error.status}` : String(error?.name || 'Error');
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
