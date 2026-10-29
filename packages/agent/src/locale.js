// Language-specific prompts. The chat's first message is classified once (prompt
// "classifiers/language"), then every prompt tagged "locale-<code>" is added to the
// system prompt. Without Langfuse, or if anything fails, the reply goes ahead without them.

import { getLangfuse } from './langfuse.js';
import { TITLE_MODEL } from './title.js';

const TTL_MS = 60_000;
const MAX_CACHED = 500;
const detected = new Map(); // first message -> language code
const listed = new Map(); // language code -> { at, names }

const options = { label: 'production', cacheTtlSeconds: 60, fetchTimeoutMs: 2000 };

export async function detectLanguage(langfuse, client, text) {
  const input = text?.trim().slice(0, 1000);
  if (!input) return null;
  if (detected.has(input)) return detected.get(input);
  const prompt = await langfuse.prompt.get('classifiers/language', options);
  const res = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 8,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt.compile({ message: input }) }],
  }, { timeout: 5_000, maxRetries: 0 });
  const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toLowerCase();
  const code = /^[a-z]{2}$/.test(raw) ? raw : null;
  if (detected.size >= MAX_CACHED) detected.clear();
  detected.set(input, code);
  return code;
}

async function localeNames(langfuse, code) {
  const hit = listed.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.names;
  const { data } = await langfuse.api.prompts.list({ tag: `locale-${code}`, limit: 20 });
  const names = data.map((p) => p.name).sort();
  listed.set(code, { at: Date.now(), names });
  return names;
}

// Returns { code, text }: the language and the joined locale prompts ('' if none). A language
// already saved with the chat (knownCode) is used as is, without classifying again.
export async function getLocale(client, firstMessage, knownCode = null) {
  const langfuse = getLangfuse();
  if (!langfuse) return { code: null, text: '' };
  try {
    const code = knownCode || await detectLanguage(langfuse, client, firstMessage);
    if (!code) return { code: null, text: '' };
    const names = await localeNames(langfuse, code);
    const parts = await Promise.all(names.map(async (name) => {
      try { return (await langfuse.prompt.get(name, options)).compile(); } catch { return ''; }
    }));
    return { code, text: parts.filter(Boolean).join('\n\n') };
  } catch (error) {
    console.error('locale lookup failed', error?.status ?? error?.name);
    return { code: null, text: '' };
  }
}
