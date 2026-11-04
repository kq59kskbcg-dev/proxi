// Intents: the user's latest message is sorted with the "classifiers/intent-router" prompt
// (for example "escalation" when they want a person, or "redaction-missed" when they say a
// card number or IBAN wasn't removed). Every prompt tagged "on-<intent>" is then added to the
// system prompt for that reply only. A new intent needs a router version that describes it and
// a snippet with its tag, no code. Without Langfuse, or if anything fails, the reply goes
// ahead without extra prompts.

import { getLangfuse } from './langfuse.js';
import { routingVariables } from './routing.js';
import { TITLE_MODEL } from './title.js';

const TTL_MS = 60_000;
const NONE = 'none';
const ESCALATION = 'escalation';
const listed = new Map(); // intent -> { at, names }

const options = { label: 'production', cacheTtlSeconds: 60, fetchTimeoutMs: 2000 };

// history: the chat's messages, the latest one last. Returns the intent, or null for none.
export async function classifyIntent(langfuse, client, history) {
  const latest = history[history.length - 1];
  if (!latest?.content?.trim()) return null;
  const prompt = await langfuse.prompt.get('classifiers/intent-router', options);
  const res = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 16,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt.compile(routingVariables(history)) }],
  }, { timeout: 5_000, maxRetries: 0 });
  const answer = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toLowerCase();
  return /^[a-z][a-z-]{0,39}$/.test(answer) && answer !== NONE ? answer : null;
}

async function promptNames(langfuse, intent) {
  const hit = listed.get(intent);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.names;
  const { data } = await langfuse.api.prompts.list({ tag: `on-${intent}`, limit: 20 });
  const names = data.map((p) => p.name).sort();
  listed.set(intent, { at: Date.now(), names });
  return names;
}

// The production prompts tagged for an intent, joined. A prompt that isn't in production yet is skipped.
export async function intentText(langfuse, intent) {
  const names = await promptNames(langfuse, intent);
  const parts = await Promise.all(names.map(async (name) => {
    try { return (await langfuse.prompt.get(name, options)).compile(); } catch { return ''; }
  }));
  return parts.filter(Boolean).join('\n\n');
}

// Returns { intent, escalated, text }: the intent found (null if none), whether the user asked
// for a person, and the text to add to the system prompt ('' when there is nothing to add).
export async function getIntent(client, history) {
  const none = { intent: null, escalated: false, text: '' };
  const langfuse = getLangfuse();
  if (!langfuse) return none;
  let intent;
  try {
    intent = await classifyIntent(langfuse, client, history);
  } catch (error) {
    console.error('intent check failed', error?.status ?? error?.name);
    return none;
  }
  if (!intent) return none;
  const escalated = intent === ESCALATION;
  try {
    return { intent, escalated, text: await intentText(langfuse, intent) };
  } catch {
    return { intent, escalated, text: '' };
  }
}
