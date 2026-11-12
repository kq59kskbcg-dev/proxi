import Anthropic from '@anthropic-ai/sdk';
import { redact } from '@proxi/agent/redact';
import { rateLimit } from '../lib/ratelimit.js';
import { requireUser } from '../lib/auth.js';
import { flushTraces, getLangfuse, getSystemPrompt, startTrace } from '@proxi/agent/langfuse';
import { hasDatabase, saveConversation, conversationAttributes, recordRedactions, searchChatMessages } from '../lib/db.js';
import { customInstructions, disabledTools } from '../lib/instructions.js';
import { processAttachments, AttachmentError } from '../lib/attachments.js';
import { parseChatRequest, label, memoryOf } from '../lib/chat-request.js';
import { savedMemories, memoryOffer } from '../lib/memories.js';
import { getMcpTools } from '@proxi/agent/mcp';
import { makeTitle } from '@proxi/agent/title';
import { suggestReplies } from '@proxi/agent/reply-suggestions';
import { getLocale } from '@proxi/agent/locale';
import { getIntent } from '@proxi/agent/intents';
import { MEMORY_TOOL, getMemoryTool } from '@proxi/agent/memory';
import { CHAT_SEARCH_TOOL, CHAT_SEARCH_TOOL_DEFINITION, searchWords, likePatterns, rankChats, chatSearchResult } from '@proxi/agent/chat-search';
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
    // A memory card still waiting when the user sends another message counts as declined.
    const memory = memoryOf(m);
    if (memory?.status === 'pending') memory.status = 'declined';
    return { role: m.role, content: text, model: label(m.model), traceId: label(m.traceId), attachments: kinds.map((kind) => ({ kind })), unavailable, memory };
  });
  // The privacy page's counts. Incognito chats have no conversation ID, so they aren't counted.
  if (conversationId && hasDatabase()) {
    await recordRedactions(user.userId, redactions, { conversationId, position: lastIndex, content: history[lastIndex].content })
      .catch((e) => console.error('counting redactions failed', e?.code ?? e?.name));
  }
  // The model sees the most recent messages word for word; older ones become a short summary.
  const { recent, older } = splitHistory(history, MAX_MESSAGES);

  client ??= new Anthropic();
  // Language comes from the chat's first message and is kept with the chat; if the latest message
  // reports a missed redaction, a reply prompt is added. Custom instructions come last.
  const attributes = conversationId ? conversationAttributes(user.userId, conversationId) : Promise.resolve({ language: null });
  const localeFor = async () => getLocale(client, history[0].content, (await attributes).language);
  // Memory is off in incognito chats: nothing is saved and saved memories aren't used.
  const memoryOn = !temporary && hasDatabase();
  // Tools turned off in Settings are never offered to the model. Turning off "Save to memory"
  // only stops new suggestions: saved memories are still used.
  const [prompt, instructions, locale, intent, memories, memoryToolDef, route, summary, toolsOff] = await Promise.all([
    getSystemPrompt(), customInstructions(user.userId), localeFor(), getIntent(client, history),
    memoryOn ? savedMemories(user.userId) : [], memoryOn ? getMemoryTool() : null,
    auto ? chooseModel(client, history) : { level: null, model: fixedModel },
    summarizeOlder(client, older), disabledTools(user.userId),
  ]);
  const memoryTool = toolsOff.has(MEMORY_TOOL) ? null : memoryToolDef;
  const model = route.model;
  const { messages, traced, system: systemText } = buildContext({
    recent, blocks: attached.blocks, maxReplyChars: MAX_REPLY_CHARS,
    parts: { prompt: prompt.text, locale: locale.text, intent: intent.text, memories, summary, instructions },
  });
  const system = { ...prompt, text: systemText };
  // Incognito chats aren't traced. No user ID in traces: Langfuse alone can't tell whose chat a
  // trace belongs to.
  const trace = temporary ? null : startTrace('chat', {
    sessionId: conversationId ?? undefined,
    input: traced,
    metadata: { redactions, language: locale.code, summarized: older.length, ...(auto ? { route: route.level } : {}) },
  });
  const generation = trace?.startObservation('reply', {
    model, input: [{ role: 'system', content: system.text }, ...traced], prompt: system.prompt,
  }, { asType: 'generation' });

  const mcp = await getMcpTools();
  // Chat search is off in incognito chats, like memory: it only searches the user's own saved chats.
  const chatSearchOn = memoryOn && !toolsOff.has(CHAT_SEARCH_TOOL);
  const origin = new URL(request.url).origin;
  const mcpTools = (mcp?.tools ?? []).filter((tool) => !toolsOff.has(tool.name));
  const tools = [...mcpTools, ...(memoryTool ? [memoryTool] : []), ...(chatSearchOn ? [CHAT_SEARCH_TOOL_DEFINITION] : [])];
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
      const memory = memoryOffer((text) => send({ type: 'memory', text }), memories);
      // A new chat gets a short AI title, made alongside the reply so nobody waits for it.
      const firstMessage = history.length === 1 ? history[0] : null;
      const titled = conversationId && firstMessage ? makeTitle(client, firstMessage.content, trace) : null;
      let text = '';
      let servedBy = model;
      let suggesting = null;
      try {
        // Routes each tool call: save_memory to the "Save to memory" card, search_chats to the
        // user's saved chats, the rest to the MCP server.
        const executeTool = async (call) => {
          const searching = call.name === CHAT_SEARCH_TOOL && chatSearchOn;
          const input = searching ? { query: redact(String(call.input?.query ?? '')).text } : call.input;
          const span = trace?.startObservation(`tool ${call.name}`, { input }, { asType: 'tool' });
          const result = call.name === MEMORY_TOOL && memoryTool ? memory.run(call)
            : searching ? await searchChats(user.userId, conversationId, origin, call.id, input.query)
            : mcp && !toolsOff.has(call.name) ? await mcp.call(call)
            : { type: 'tool_result', tool_use_id: call.id, content: 'This tool is not available.', is_error: true };
          // Past chats' passages stay out of traces: only how many chats matched.
          const output = searching && Array.isArray(result.content) ? { chats: result.content.length } : result.content;
          span?.update({ output, level: result.is_error ? 'ERROR' : 'DEFAULT' }).end();
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
        // Tap-to-answer chips when the reply ends with a short-answer question. They're worked out
        // while the chat is saved, so the reply never waits for them.
        if (text.trim() && final.stop_reason !== 'refusal') suggesting = suggestReplies(getLangfuse(), client, text, trace);
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
          const suggested = memory.shown() ? { text: memory.shown(), status: 'pending' } : null;
          const reply = text || suggested ? [{ role: 'assistant', content: text, model: servedBy, traceId: trace?.traceId ?? null, memory: suggested }] : [];
          await saveConversation(user.userId, conversationId, aiTitle || titleFrom(history), [...history, ...reply], { replaceTitle: Boolean(aiTitle), language: locale.code })
            .catch((e) => console.error('saving chat failed', e));
        }
        const suggestions = suggesting ? await suggesting : [];
        if (suggestions.length) {
          try { send({ type: 'suggestions', options: suggestions }); } catch {}
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

// Runs search_chats over the user's saved chats, except this one. Resolves to its tool_result.
async function searchChats(userId, conversationId, origin, toolUseId, query) {
  const words = searchWords(query);
  if (!words.length) return { type: 'tool_result', tool_use_id: toolUseId, content: 'Give a few keywords to search for.', is_error: true };
  try {
    const rows = await searchChatMessages(userId, likePatterns(words), conversationId);
    return chatSearchResult(toolUseId, rankChats(rows, words), origin);
  } catch (error) {
    console.error('chat search failed', error?.code ?? error?.name);
    return { type: 'tool_result', tool_use_id: toolUseId, content: 'Searching saved chats failed.', is_error: true };
  }
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
