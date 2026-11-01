import Anthropic from '@anthropic-ai/sdk';

// The errors people see in a chat. The page shows each as a card: a title, one sentence and a
// "Try again" button, with a short reference for reporting a problem. Whose problem it is comes
// first, so nobody rewrites a message that was fine. The page has its own copy of the two cards it
// raises itself (no connection, and an answer it can't read); a test keeps that copy equal.
const COPY = {
  busy: { title: 'Proxi is busy right now', body: 'Too many requests at once. Try again in a minute.' },
  limit: { title: 'Too many messages', body: "You've sent a lot of messages in a short time. Wait a few minutes, then try again." },
  session: { title: 'Your session expired', body: 'Try again to sign back in. If it keeps happening, reload the page.' },
  error: { title: 'Something went wrong on our side', body: 'Your message is fine. Try again.' },
};

export const ERROR_KINDS = Object.keys(COPY);
export const ERROR_COPY = COPY;

// A response for the page: the card, plus the same words as one line for anything that shows text.
export function cardResponse(kind, ref) {
  const { title, body } = COPY[kind];
  return { error: `${title}. ${body}`, card: { title, body, ref } };
}

// Which card a failed call to Claude gets. A busy or overloaded service says so; anything else
// (a request Claude rejected, a server error, a setup problem) is on our side, and the reference
// carries the status for whoever looks into it.
export function replyError(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (error instanceof Anthropic.RateLimitError || status === 529) return { kind: 'busy', ref: String(status) };
  return { kind: 'error', ref: status ? String(status) : 'error' };
}
