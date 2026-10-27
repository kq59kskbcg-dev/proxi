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
Some details in the conversation may appear as [CARD], [IBAN], [EMAIL] or [PHONE]. These were removed for privacy before reaching you. Never ask the user to share them again.`;

// The system prompt is edited in Langfuse (prompt "proxi-system", label "production").
// Falls back to the built-in prompt if Langfuse is not set up or unreachable.
export async function getSystemPrompt() {
  const langfuse = getLangfuse();
  if (!langfuse) return { text: DEFAULT_SYSTEM_PROMPT, prompt: undefined };
  try {
    const prompt = await langfuse.getPrompt('proxi-system', undefined, {
      label: 'production', fallback: DEFAULT_SYSTEM_PROMPT, cacheTtlSeconds: 60, fetchTimeoutMs: 2000,
    });
    return { text: prompt.compile(), prompt: prompt.isFallback ? undefined : prompt };
  } catch {
    return { text: DEFAULT_SYSTEM_PROMPT, prompt: undefined };
  }
}
