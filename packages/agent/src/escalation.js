// Escalation: the user's latest message is checked with the "classifiers/escalation" prompt.
// When it says they want a person, "snippets/escalation-reply" is added to the system prompt
// for that reply. Without Langfuse, or if anything fails, the reply goes ahead without it.

import { classify, getLangfuse, getSnippet } from './langfuse.js';

export async function wantsPerson(langfuse, client, text) {
  const input = text?.trim().slice(0, 1000);
  if (!input) return false;
  return (await classify(client, 'classifiers/escalation', { message: input }, { langfuse })) === 'true';
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
  return { escalated: true, text: await getSnippet('snippets/escalation-reply', { langfuse }) };
}
