import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor, isLangfuseSpan } from '@langfuse/otel';
import { startObservation } from '@langfuse/tracing';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { CLASSIFIER_MODEL } from './models.js';

// Langfuse is optional: without keys the app still works, it just isn't logged.
const configured = () => Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
const baseUrl = () => process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';

// Prompts, datasets and scores.
let client = null;
export function getLangfuse() {
  if (client || !configured()) return client;
  client = new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: baseUrl(),
  });
  return client;
}

// Traces go to Langfuse over OpenTelemetry. Spans are sent as soon as they end, since a
// serverless function can be frozen right after it replies; flushTraces() waits for them.
let processor = null;
export function enableTracing() {
  if (processor || !configured()) return processor;
  processor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: baseUrl(),
    exportMode: 'immediate',
    // Only the spans made by startTrace. The Anthropic SDK also reports its own calls (the
    // classifiers run in incognito chats too), and those must not reach Langfuse.
    shouldExportSpan: ({ otelSpan }) => isLangfuseSpan(otelSpan),
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
  return processor;
}

// Starts a trace: its root span, or null without Langfuse. Child spans come from
// trace.startObservation(name, attributes, { asType }).
export function startTrace(name, { sessionId, ...attributes } = {}) {
  if (!enableTracing()) return null;
  const root = startObservation(name, attributes);
  if (sessionId) root.otelSpan.setAttribute('session.id', sessionId);
  return root;
}

// Deletes traces (best effort: a failure is logged and never blocks the caller). Only
// real trace IDs are sent, since the IDs saved with messages come from the browser.
export async function deleteTraces(ids) {
  const langfuse = getLangfuse();
  const list = [...new Set(ids ?? [])].filter((id) => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id));
  if (!langfuse || !list.length) return;
  for (let i = 0; i < list.length; i += 100) {
    try {
      await langfuse.api.trace.deleteMultiple({ traceIds: list.slice(i, i + 100) });
    } catch (error) {
      console.error('deleting traces failed', error?.name);
    }
  }
}

// One page of chat traces started before `before`, as { traceId, sessionId } (the session is
// the saved chat's ID), and the cursor for the next page, or null when there is none.
export async function listChatTraces({ before, cursor = null }) {
  const langfuse = getLangfuse();
  if (!langfuse) return { traces: [], cursor: null };
  const res = await langfuse.api.observations.getMany({
    name: 'chat', isRootObservation: true, toStartTime: before.toISOString(),
    fields: 'core,basic,trace_context', limit: 100, ...(cursor ? { cursor } : {}),
  });
  return {
    traces: (res.data ?? []).map((o) => ({ traceId: o.traceId, sessionId: o.sessionId ?? null })),
    cursor: res.meta?.cursor ?? null,
  };
}

export async function flushTraces() {
  await processor?.forceFlush().catch(() => {});
}

export const DEFAULT_SYSTEM_PROMPT = `You are Proxi, a helpful assistant.
Be warm, clear and honest: answer first, in plain words, and say when you are unsure or can't help.
Some details in the conversation may appear as [IBAN], [EMAIL] or [PHONE], and card numbers as •••• •••• •••• followed by their last 4 digits. These were removed for privacy before reaching you. Never ask the user to share them again.
For questions about Proxi itself (features, privacy, security), use the search_docs tool and base your answer on what it returns.
Use web_search only when the answer depends on current or changing information, or on facts you don't know. Otherwise answer directly. Cite the web pages you use.`;

// Prompts added to every reply, after main-system, in this order. Each one is a text
// prompt in Langfuse with the label "production"; one that is missing or unreachable is skipped.
export const SNIPPETS = ['snippets/tone-format', 'snippets/privacy-redaction'];

const PROMPT_OPTIONS = { label: 'production', cacheTtlSeconds: 60, fetchTimeoutMs: 2000 };

// One short structured line when a prompt isn't used as fetched. Only the prompt's name and
// the error's status or name, never the prompt text or what the user wrote.
export function logPrompt(event, name, error) {
  console.warn(JSON.stringify({ event, prompt: name, error: String(error?.status ?? error?.name ?? 'fallback') }));
}

// The built-in copy of a prompt, compiled like a Langfuse text prompt.
function builtIn(text) {
  return {
    prompt: undefined,
    compile: (variables = {}) => text.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in variables ? String(variables[key]) : all)),
  };
}

// A prompt from Langfuse (label "production"), as { compile(variables), prompt }. `prompt` is
// the Langfuse prompt to link to a trace, or undefined when the built-in `fallback` is used:
// without Langfuse, or (logged) when it can't be fetched. Without a fallback, a prompt that
// can't be fetched throws, and the caller decides what to do. `langfuse` defaults to the app's.
export async function getPrompt(name, { fallback, langfuse = getLangfuse() } = {}) {
  const hasFallback = typeof fallback === 'string';
  if (!langfuse) {
    if (hasFallback) return builtIn(fallback);
    throw new Error('Langfuse is not set up');
  }
  try {
    const prompt = await langfuse.prompt.get(name, hasFallback ? { ...PROMPT_OPTIONS, fallback } : PROMPT_OPTIONS);
    if (!prompt.isFallback) return { prompt, compile: (variables) => prompt.compile(variables) };
    logPrompt('prompt_fallback', name);
  } catch (error) {
    if (!hasFallback) throw error;
    logPrompt('prompt_fallback', name, error);
  }
  return builtIn(fallback);
}

// Asks the small model a classifier prompt with these variables and returns its answer,
// trimmed and lower case. Throws when the prompt can't be fetched or the call fails, so each
// caller logs and picks its own safe answer.
export async function classify(client, promptName, variables, { maxTokens = 8, timeout = 5_000, fallback, langfuse } = {}) {
  const prompt = await getPrompt(promptName, { fallback, langfuse });
  const res = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt.compile(variables) }],
  }, { timeout, maxRetries: 0 });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toLowerCase();
}

// A snippet's text, or '' when it is missing or unreachable (logged).
export async function getSnippet(name, { langfuse } = {}) {
  try {
    return (await getPrompt(name, { langfuse })).compile();
  } catch (error) {
    logPrompt('snippet_skipped', name, error);
    return '';
  }
}

// The system prompt is edited in Langfuse: "main-system" plus the snippets above, joined
// into one text. Falls back to the built-in prompt if Langfuse is not set up or unreachable.
// Only main-system is linked to the trace.
export async function getSystemPrompt() {
  const [main, ...snippets] = await Promise.all([
    getPrompt('main-system', { fallback: DEFAULT_SYSTEM_PROMPT }),
    ...SNIPPETS.map((name) => (getLangfuse() ? getSnippet(name) : '')),
  ]);
  const text = [main.compile(), ...snippets].filter(Boolean).join('\n\n');
  return { text, prompt: main.prompt };
}
