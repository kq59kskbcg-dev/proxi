// Auto model: the latest message is sorted into simple, standard or complex with the
// "classifiers/model-routing" prompt, and each level has its model. Without Langfuse, the
// built-in copy of the prompt is used; if the check fails, the reply uses the standard model.

import { getLangfuse } from './langfuse.js';
import { TITLE_MODEL } from './title.js';

export const ROUTES = {
  simple: 'claude-haiku-5-5',
  standard: 'claude-sonnet-5-5',
  complex: 'claude-opus-5-5',
};
const FALLBACK_LEVEL = 'standard';
const CONTEXT_MESSAGES = 6; // earlier messages shown to the classifier
const MAX_CONTEXT_CHARS = 500; // per earlier message
const MAX_MESSAGE_CHARS = 2000;

export const DEFAULT_ROUTING_PROMPT = `You choose which AI model size should answer a chat message. Reply with exactly one word: simple, standard or complex. Do not answer the message.

simple
Short, direct requests with a clear answer and no reasoning needed.
Examples: greetings and thanks, a quick fact, a definition, a rewrite or translation of a sentence, a yes or no question.

standard
Most everyday requests that need a clear, accurate explanation or a few steps.
Examples: explaining a concept, summarizing a text, drafting an email, comparing two options, basic code questions, questions about how Proxi works.

complex
Requests that need careful, multi-step reasoning or a long, detailed answer.
Examples: debugging non-trivial code, designing a system, analysing a long document, math or logic puzzles, legal or financial reasoning, anything with several competing constraints.

Rules
- Judge how hard the request is, not how long the message is.
- If you are unsure between two levels, choose the higher one.
- A message that needs a search, or that comes with an attachment, is at least standard.
- A short follow-up such as "why?" or "go on" takes the level of the conversation so far.
- Reply with the single word only.

Conversation so far:
{{context}}

Message:
{{message}}`;

const options = { label: 'production', fallback: DEFAULT_ROUTING_PROMPT, cacheTtlSeconds: 60, fetchTimeoutMs: 2000 };

// history: the chat's messages ({ role, content, attachments? }), the latest one last.
export function routingVariables(history) {
  const latest = history[history.length - 1];
  const earlier = history.slice(0, -1).slice(-CONTEXT_MESSAGES);
  const context = earlier.length
    ? earlier.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, MAX_CONTEXT_CHARS)}`).join('\n')
    : '(none)';
  const attached = latest.attachments?.length ? '\n(The message comes with an attachment.)' : '';
  return { context, message: latest.content.slice(0, MAX_MESSAGE_CHARS) + attached };
}

async function compileRoutingPrompt(variables) {
  const langfuse = getLangfuse();
  if (langfuse) return (await langfuse.getPrompt('classifiers/model-routing', undefined, options)).compile(variables);
  return DEFAULT_ROUTING_PROMPT.replace('{{context}}', variables.context).replace('{{message}}', variables.message);
}

// Returns { level, model }.
export async function chooseModel(client, history) {
  try {
    const res = await client.messages.create({
      model: TITLE_MODEL,
      max_tokens: 8,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: await compileRoutingPrompt(routingVariables(history)) }],
    }, { timeout: 5_000, maxRetries: 0 });
    const answer = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toLowerCase();
    const level = ROUTES[answer] ? answer : FALLBACK_LEVEL;
    return { level, model: ROUTES[level] };
  } catch (error) {
    console.error('model routing failed', error?.status ?? error?.name);
    return { level: FALLBACK_LEVEL, model: ROUTES[FALLBACK_LEVEL] };
  }
}
