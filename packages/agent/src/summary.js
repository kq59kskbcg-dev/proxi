// Long chats: only the latest messages are sent to the model word for word, so the ones before
// them are boiled down to a short summary by Haiku. The messages are already redacted. If the
// summary can't be made, the reply goes ahead without it.

import { createHash } from 'node:crypto';
import { getPrompt } from './langfuse.js';
import { CLASSIFIER_MODEL } from './models.js';

const MAX_PER_MESSAGE = 600; // characters kept of each older message
const MAX_INPUT = 30_000; // characters of older messages sent to be summarized (the latest are kept)
const MAX_SUMMARY_TOKENS = 700;
const CACHE_SIZE = 50;

export const DEFAULT_SUMMARY_PROMPT = `You are given the earlier part of a chat between a user and an AI assistant. Write a short summary the assistant can use to continue the chat.
Keep: what the user is trying to do, facts and preferences they gave, decisions made, and questions still open.
Leave out greetings, pleasantries and anything already settled that won't matter again.
Write plain notes in the same language as the chat, in at most 200 words. Do not answer or continue the chat.
Reply with the summary only.`;

// The summary prompt is edited in Langfuse (prompt "summarizers/conversation-history", label
// "production"), with the built-in prompt as the fallback.
async function getSummaryPrompt() {
  const prompt = await getPrompt('summarizers/conversation-history', { fallback: DEFAULT_SUMMARY_PROMPT });
  return { text: prompt.compile(), prompt: prompt.prompt };
}

// The older messages as one block of text, cutting each, and the start of the chat if it is long.
export function transcript(older) {
  const lines = older.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, MAX_PER_MESSAGE)}`);
  let text = lines.join('\n');
  if (text.length > MAX_INPUT) text = text.slice(-MAX_INPUT);
  return text;
}

// A chat's summary only changes when more messages fall out of view, so a warm server reuses it.
const cache = new Map();
function remember(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
}

// Returns the summary text, or '' when there is nothing to summarize or it couldn't be made.
export async function summarizeOlder(client, older, trace) {
  if (!older?.length) return '';
  const input = transcript(older);
  if (!input.trim()) return '';
  const key = createHash('sha256').update(input).digest('hex');
  if (cache.has(key)) return cache.get(key);
  const system = await getSummaryPrompt();
  const generation = trace?.startObservation('summary', { model: CLASSIFIER_MODEL, input, prompt: system.prompt }, { asType: 'generation' });
  try {
    const res = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: MAX_SUMMARY_TOKENS,
      thinking: { type: 'disabled' },
      system: system.text,
      messages: [{ role: 'user', content: input }],
    }, { timeout: 8_000, maxRetries: 0 });
    const text = res.stop_reason === 'refusal' ? '' : res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    generation?.update({ output: text, usageDetails: { input: res.usage.input_tokens, output: res.usage.output_tokens } }).end();
    if (text) remember(key, text);
    return text;
  } catch (error) {
    generation?.update({ level: 'ERROR', statusMessage: String(error?.status ?? error?.name ?? 'Error') }).end();
    console.error('chat summary failed', error?.status ?? error?.name);
    return '';
  }
}
