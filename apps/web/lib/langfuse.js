import { Langfuse } from 'langfuse';

// Tracing is optional: without keys the app still works, it just isn't logged.
let client = null;
export function getLangfuse() {
  if (client || !process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return client;
  client = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
  });
  return client;
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
    const prompt = await langfuse.getPrompt(name, undefined, options(''));
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
      langfuse.getPrompt('main-system', undefined, options(DEFAULT_SYSTEM_PROMPT)),
      ...SNIPPETS.map((name) => getSnippet(langfuse, name)),
    ]);
    const text = [prompt.compile(), ...snippets].filter(Boolean).join('\n\n');
    return { text, prompt: prompt.isFallback ? undefined : prompt };
  } catch {
    return { text: DEFAULT_SYSTEM_PROMPT, prompt: undefined };
  }
}
