// Suggested replies: after a reply, Haiku reads its end (prompt "classifiers/reply-suggestions")
// and lists 2 or 3 short answers when it ends with a question the user can answer with a tap,
// such as ["Yes", "No"]. The page shows them as chips. Without Langfuse, or a production version
// of the prompt, or if anything fails or takes over 2 seconds, there are no suggestions.

import { TITLE_MODEL } from './title.js';

export const SUGGESTIONS_PROMPT = 'classifiers/reply-suggestions';
const MAX_INPUT = 1500; // the question is almost always at the end of the reply
const TIMEOUT_MS = 2000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;
const MAX_OPTION_CHARS = 30;

const options = { label: 'production', cacheTtlSeconds: 60, fetchTimeoutMs: 1000 };

// The model's answer as a list of 2 or 3 options, or [] when it isn't one.
export function parseSuggestions(raw) {
  let list;
  try {
    list = typeof raw === 'string' ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(list) || list.length < MIN_OPTIONS || list.length > MAX_OPTIONS) return [];
  const clean = [];
  for (const item of list) {
    if (typeof item !== 'string') return [];
    const text = item.replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_OPTION_CHARS) return [];
    if (clean.some((c) => c.toLowerCase() === text.toLowerCase())) return [];
    clean.push(text);
  }
  return clean;
}

// Calls the prompt for one reply. Throws on errors: suggestReplies turns them into [].
export async function classifySuggestions(langfuse, client, reply, { timeout = TIMEOUT_MS } = {}) {
  const input = String(reply ?? '').trim().slice(-MAX_INPUT);
  if (!input) return { options: [], prompt: null, raw: '', usage: null };
  const prompt = await langfuse.prompt.get(SUGGESTIONS_PROMPT, options);
  const res = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 64,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt.compile({ reply: input }) }],
  }, { timeout, maxRetries: 0 });
  const raw = res.stop_reason === 'refusal' ? '' : res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { options: parseSuggestions(raw), prompt, raw, usage: res.usage };
}

// Returns the options for a finished reply, or [] for none.
export async function suggestReplies(langfuse, client, reply, trace) {
  if (!langfuse) return [];
  const generation = trace?.startObservation('suggestions', { model: TITLE_MODEL }, { asType: 'generation' });
  let timer;
  // 2 seconds in all, fetching the prompt included.
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Timed out'), { name: 'Timeout' })), TIMEOUT_MS); });
  try {
    const { options: found, prompt, raw, usage } = await Promise.race([classifySuggestions(langfuse, client, reply), deadline]);
    generation?.update({ output: raw, prompt: prompt?.isFallback ? undefined : prompt ?? undefined, ...(usage ? { usageDetails: { input: usage.input_tokens, output: usage.output_tokens } } : {}) }).end();
    return found;
  } catch (error) {
    generation?.update({ level: 'WARNING', statusMessage: String(error?.status ?? error?.name ?? 'Error') }).end();
    // A prompt not promoted yet isn't an error: the feature is simply off.
    if (!/not found/i.test(String(error?.message))) console.error('reply suggestions failed', error?.status ?? error?.name);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// How the eval compares two answers: the same options, ignoring case and order.
export function suggestionKey(value) {
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value.trim()); } catch { return value.trim().toLowerCase(); }
  }
  if (!Array.isArray(list)) return JSON.stringify(list);
  return JSON.stringify(list.map((x) => String(x).trim().toLowerCase()).sort());
}
