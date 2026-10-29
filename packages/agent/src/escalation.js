// Escalation: the user's latest message is checked with the "classifiers/escalation" prompt.
// When it says they want a person, "snippets/escalation-reply" is added to the system prompt
// for that reply. Without Langfuse, or if anything fails, the reply goes ahead without it.

import { getLangfuse } from './langfuse.js';
import { TITLE_MODEL } from './title.js';

const options = { label: 'production', cacheTtlSeconds: 60, fetchTimeoutMs: 2000 };

export async function wantsPerson(langfuse, client, text) {
  const input = text?.trim().slice(0, 1000);
  if (!input) return false;
  const prompt = await langfuse.getPrompt('classifiers/escalation', undefined, options);
  const res = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 8,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt.compile({ message: input }) }],
  }, { timeout: 5_000, maxRetries: 0 });
  const answer = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toLowerCase();
  return answer === 'true';
}

// Returns { escalated, text }: whether the message asked for a person, and the text to add to
// the system prompt ('' when there is nothing to add).
export async function getEscalation(client, latestMessage) {
  const langfuse = getLangfuse();
  if (!langfuse) return { escalated: false, text: '' };
  try {
    if (!(await wantsPerson(langfuse, client, latestMessage))) return { escalated: false, text: '' };
  } catch (error) {
    console.error('escalation check failed', error?.status ?? error?.name);
    return { escalated: false, text: '' };
  }
  try {
    return { escalated: true, text: (await langfuse.getPrompt('snippets/escalation-reply', undefined, options)).compile() };
  } catch {
    return { escalated: true, text: '' };
  }
}
