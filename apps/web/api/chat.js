import Anthropic from '@anthropic-ai/sdk';
import { redact } from '@proxi/agent/redact';
import { rateLimit } from '../lib/ratelimit.js';
import { requireUser } from '../lib/auth.js';
import { flushTraces, getSystemPrompt, startTrace } from '@proxi/agent/langfuse';
import { hasDatabase, saveConversation, conversationAttributes } from '../lib/db.js';
import { customInstructions } from '../lib/instructions.js';
import { processAttachments, AttachmentError } from '../lib/attachments.js';
import { parseChatRequest, label } from '../lib/chat-request.js';
import { savedMemories, remember } from '../lib/memories.js';
import { getMcpTools } from '@proxi/agent/mcp';
import { makeTitle } from '@proxi/agent/title';
import { getLocale } from '@proxi/agent/locale';
import { getEscalation } from '@proxi/agent/escalation';
import { MEMORY_TOOL, getMemoryTool } from '@proxi/agent/memory';
import { runAgentLoop } from '@proxi/agent/agent-loop';
import { buildContext, splitHistory } from '@proxi/agent/context';
import { summarizeOlder } from '@proxi/agent/summary';
import { chooseModel } from '@proxi/agent/routing';
import { toolActivity } from '../lib/activity.js';
import { cardResponse, replyError } from '../lib/errors.js';
import { MAX_REPLY_CHARS, CHAT_FULL, CHAT_TOO_LARGE } from '../lib/limits.js';

// Opus and Sonnet support server-side refusal fallbacks; Haiku does not.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const MAX_TOKENS = 8000; // cost cap per reply
const MAX_MESSAGES = 40; // most recent messages sent to the model
const MAX_BODY_BYTES = 4_400_000; // Vercel rejects request bodies over 4.5 MB
const MAX_TOOL_ROUNDS = 5;

let client;

export async function POST(request) {
  const user = await requireUser(request);
  if (!user.userId) {
    // An expired or missing sign-in is the user's to renew; a site that isn't set up is ours.
    const ref = [user.status, user.reason].filter(Boolean).join(' · ');
    return json(cardResponse(user.status === 401 ? 'session' : 'error', ref), user.status);
  }

  const limit = rateLimit(user.userId);
  if (!limit.ok) {
    return json(cardResponse('limit', '429 · limit'), 429, { 'Retry-After': String(limit.retryAfter) });
  }

  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return json({ error: CHAT_TOO_LARGE }, 413);
  }
  let body;
  try { body = await request.json(); } catch { return json(cardResponse('error', '400 · invalid'), 400); }

  const parsed = parseChatRequest(body);
  if (parsed.error === 'invalid') return json(cardResponse('error', '400 · invalid'), 400);
  if (parsed.error === 'full') return json({ error: CHAT_FULL }, 400);
  const { auto, fixedModel, messages: raw, temporary, conversationId } = parsed;
  const lastIndex = raw.length - 1;

  // Files attached to the latest message are checked, redacted where possible and
  // turned into content blocks. They are used for this request only, never stored.
  let attached = { blocks: [], kinds: [], notices: [], redactions: {} };
  const files = (raw[lastIndex].attachments || []).filter((a) => typeof a.data === 'string');
  try {
    if (files.length) attached = await processAttachments(files);
  } catch (error) {
    if (error instanceof AttachmentError) return json({ error: error.message }, 422);
    console.error('attachment processing failed', error);
    return json(cardResponse('error', '500 · attachments'), 500);
  }

  // Redact every message, including earlier ones, before the model or logs see them.
  const redactions = { ...attached.redactions };
  let fileKinds = [...attached.kinds];
  const history = raw.map((m, i) => {
    // The user's messages are redacted every time (the page keeps the original text).
    // Proxi's own replies are left alone: the model only ever saw redacted input.
    const { text, counts } = m.role === 'user' ? redact(m.content) : { text: m.content, counts: {} };
    // Only what was removed from the message just sent is reported back to the page.
    if (i === lastIndex) for (const [k, v] of Object.entries(counts)) redactions[k] = (redactions[k] || 0) + v;
    // Only the kind of each file is kept, for the "removed" label in saved chats.
    const kinds = [];
    const unavailable = [];
    for (const a of m.attachments || []) {
      if (typeof a.data === 'string') kinds.push(fileKinds.shift());
      else { kinds.push(a.kind); unavailable.push(a.kind); }
    }
    return { role: m.role, content: text, model: label(m.model), traceId: label(m.traceId), attachments: kinds.map((kind) => ({ kind })), unavailable };
  });
  // The model sees the most recent messages word for word; older ones become a short summary.
  const { recent, older } = splitHistory(history, MAX_MESSAGES);
  const latest = history[history.length - 1];

  client ??= new Anthropic();
  // Language comes from the chat's first message and is kept with the chat; if the latest message
  // asks for a person, a reply prompt is added. Custom instructions come last.
  const localeFor = async () => getLocale(client, history[0].content, conversationId ? (await conversationAttributes(user.userId, conversationId)).language : null);
  // Memory is off in incognito chats: nothing is saved and saved memories aren't used.
  const memoryOn = !temporary && hasDatabase();
  const [prompt, instructions, locale, escalation, memories, memoryTool, route, summary] = await Promise.all([
    getSystemPrompt(), customInstructions(user.userId), localeFor(), getEscalation(client, latest.content),
    memoryOn ? savedMemories(user.userId) : [], memoryOn ? getMemoryTool() : null,
    auto ? chooseModel(client, history) : { level: null, model: fixedModel },
    summarizeOlder(client, older),
  ]);
  const model = route.model;
  const { messages, traced, system: systemText } = buildContext({
    recent, blocks: attached.blocks, maxReplyChars: MAX_REPLY_CHARS,
    parts: { prompt: prompt.text, locale: locale.text, escalation: escalation.text, memories, summary, instructions },
  });
  const system = { ...prompt, text: systemText };
  // Incognito chats aren't traced. No user ID in traces: Langfuse alone can't tell whose chat a
  // trace belongs to.
  const trace = temporary ? null : startTrace('chat', {
    sessionId: conversationId ?? undefined,
    input: traced,
    metadata: { redactions, language: locale.code, escalated: escalation.escalated, summarized: older.length, ...(auto ? { route: route.level } : {}) },
  });
  const generation = trace?.startObservation('reply', {
    model, input: [{ role: 'system', content: system.text }, ...traced], prompt: system.prompt,
  }, { asType: 'generation' });

  const mcp = await getMcpTools();
  const tools = [...(mcp?.tools ?? []), ...(memoryTool ? [memoryTool] : [])];
  const params = {
    model,
    max_tokens: MAX_TOKENS,
    system: system.text,
    output_config: { effort: 'low' }, // chat rarely needs deep thinking; keeps replies fast and cheap
    ...(tools.length ? { tools } : {}),
  };
  const open = (turns) => FALLBACK_MODELS.has(model)
    ? client.beta.messages.stream({ ...params, messages: turns, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: request.signal })
    : client.messages.stream({ ...params, messages: turns }, { signal: request.signal });
  let stream;

  const encoder = new TextEncoder();
  const body$ = new ReadableStream({
    async start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      send({ type: 'start', traceId: trace?.traceId ?? null, redactions, notices: attached.notices });
      // A new chat gets a short AI title, made alongside the reply so nobody waits for it.
      const firstMessage = history.length === 1 ? history[0] : null;
      const titled = conversationId && firstMessage ? makeTitle(client, firstMessage.content, trace) : null;
      let text = '';
      let servedBy = model;
      try {
        // Routes each tool call: save_memory to the user's memories, the rest to the MCP server.
        const executeTool = async (call) => {
          const span = trace?.startObservation(`tool ${call.name}`, { input: call.input }, { asType: 'tool' });
          const result = call.name === MEMORY_TOOL && memoryTool ? await remember(user.userId, call)
            : mcp ? await mcp.call(call)
            : { type: 'tool_result', tool_use_id: call.id, content: 'This tool is not available.', is_error: true };
          span?.update({ output: result.content, level: result.is_error ? 'ERROR' : 'DEFAULT' }).end();
          return result;
        };
        const onEvent = (event) => {
          if (event.type === 'text') {
            text += event.text;
            send({ type: 'text', text: event.text });
          } else if (event.type === 'tool_calls') {
            // Tell the page what the agent is doing, e.g. "Searching the help center".
            for (const call of event.calls) send({ type: 'activity', tool: call.name, ...toolActivity(call.name, mcp?.titles?.[call.name], call.input) });
          }
        };
        const { final, usage } = await runAgentLoop({
          open: (turns) => (stream = open(turns)),
          messages,
          toolsEnabled: tools.length > 0,
          executeTool,
          onEvent,
          maxRounds: MAX_TOOL_ROUNDS,
        });
        servedBy = final.model;
        if (final.stop_reason === 'refusal') {
          send({ type: 'error', error: "Proxi can't help with that request." });
        }
        generation?.update({
          output: text,
          usageDetails: usage,
          metadata: { stopReason: final.stop_reason, servedBy: final.model },
        }).end();
        trace?.update({ output: text });
        send({ type: 'done', stopReason: final.stop_reason, model: final.model });
      } catch (error) {
        if (request.signal.aborted) {
          generation?.update({ output: text, level: 'WARNING', statusMessage: 'Stopped by user' }).end();
        } else {
          generation?.update({ output: text, level: 'ERROR', statusMessage: errorName(error) }).end();
          const { kind, ref } = replyError(error);
          send({ type: 'error', ...cardResponse(kind, ref) });
        }
      } finally {
        // Save the chat (already redacted), including a partial reply if it was stopped.
        const aiTitle = titled ? await titled : null;
        if (aiTitle) {
          try { send({ type: 'title', title: aiTitle }); } catch {}
        }
        if (conversationId && hasDatabase()) {
          const reply = text ? [{ role: 'assistant', content: text, model: servedBy, traceId: trace?.traceId ?? null }] : [];
          await saveConversation(user.userId, conversationId, aiTitle || titleFrom(history), [...history, ...reply], { replaceTitle: Boolean(aiTitle), language: locale.code, escalated: escalation.escalated })
            .catch((e) => console.error('saving chat failed', e));
        }
        trace?.end();
        await flushTraces();
        try { controller.close(); } catch {}
      }
    },
    cancel() { stream?.abort(); },
  });

  return new Response(body$, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function titleFrom(history) {
  const user = history.find((m) => m.role === 'user');
  const first = user?.content.trim().replace(/\s+/g, ' ') || (user?.attachments.length ? 'Attachment' : 'New chat');
  return first.length > 40 ? first.slice(0, 40).trim() + '...' : first;
}

function errorName(error) {
  return error instanceof Anthropic.APIError ? `${error.constructor.name} ${error.status}` : String(error?.name || 'Error');
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
