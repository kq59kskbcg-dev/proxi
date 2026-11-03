import Anthropic from '@anthropic-ai/sdk';
import { ERROR_COPY } from './error-copy.js';

// The cards' words are in error-copy.js, which the page imports too.
const COPY = ERROR_COPY;

export const ERROR_KINDS = Object.keys(COPY);
export { ERROR_COPY };

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
