// Short chat titles, written by Haiku from the user's first (already redacted) message.

export const TITLE_MODEL = 'claude-haiku-5-5';
const MAX_TITLE = 40;
const MAX_INPUT = 4000; // the opening of a long message is enough to name it

const PROMPT = `Write a title for a chat that starts with the user's message.
Name the topic in at most 5 words. Don't repeat the message word for word: "what's the capital of france" becomes "Capital of France".
Use the same language as the message, sentence case, no quotes and no ending punctuation.
Reply with the title only.`;

// Returns a title, or null if one couldn't be made (the caller keeps its fallback).
export async function makeTitle(client, text, trace) {
  const input = text?.trim().slice(0, MAX_INPUT);
  if (!input) return null;
  const generation = trace?.generation({ name: 'title', model: TITLE_MODEL, input });
  try {
    const res = await client.messages.create({
      model: TITLE_MODEL,
      max_tokens: 64,
      thinking: { type: 'disabled' }, // a title needs no reasoning
      system: PROMPT,
      messages: [{ role: 'user', content: input }],
    }, { timeout: 10_000, maxRetries: 1 });
    const raw = res.stop_reason === 'refusal' ? '' : res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const title = cleanTitle(raw);
    generation?.end({ output: title, usageDetails: { input: res.usage.input_tokens, output: res.usage.output_tokens } });
    return title;
  } catch (error) {
    generation?.end({ level: 'ERROR', statusMessage: String(error?.status ?? error?.name ?? 'Error') });
    console.error('title generation failed', error?.status ?? error?.name);
    return null;
  }
}

export function cleanTitle(raw) {
  let title = String(raw ?? '').split('\n')[0]
    .replace(/[*_#`"“”‘’]/g, '')
    .replace(/^title\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?:;,]+$/, '')
    .trim();
  if (title.length > MAX_TITLE) {
    const cut = title.slice(0, MAX_TITLE);
    title = (cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trim();
  }
  return title || null;
}
