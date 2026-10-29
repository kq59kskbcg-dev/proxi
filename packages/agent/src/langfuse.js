import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { startObservation } from '@langfuse/tracing';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

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

const options = (fallback) => ({ label: 'production', fallback, cacheTtlSeconds: 60, fetchTimeoutMs: 2000 });

async function getSnippet(langfuse, name) {
  try {
    const prompt = await langfuse.prompt.get(name, options(''));
    return prompt.isFallback ? '' : prompt.compile();
  } catch {
    return '';
  }
}

// The system prompt is edited in Langfuse: "main-system" plus the snippets above, joined
// into one text. Falls back to the built-in prompt if Langfuse is not set up or unreachable.
// Only main-system is linked to the trace.
export async function getSystemPrompt() {
  const langfuse = getLangfuse();
  if (!langfuse) return { text: DEFAULT_SYSTEM_PROMPT, prompt: undefined };
  try {
    const [prompt, ...snippets] = await Promise.all([
      langfuse.prompt.get('main-system', options(DEFAULT_SYSTEM_PROMPT)),
      ...SNIPPETS.map((name) => getSnippet(langfuse, name)),
    ]);
    const text = [prompt.compile(), ...snippets].filter(Boolean).join('\n\n');
    return { text, prompt: prompt.isFallback ? undefined : prompt };
  } catch {
    return { text: DEFAULT_SYSTEM_PROMPT, prompt: undefined };
  }
}
