// What one message and one chat can hold, and the words for it: the same file the server uses.
// Vercel serves lib/ as static files next to ui/, so the page imports it as is.
export { MAX_MESSAGE_CHARS, MAX_CHAT_MESSAGES, MESSAGE_TOO_LONG, CHAT_FULL, CHAT_TOO_LARGE } from '../lib/limits.js';
import { ERROR_COPY } from '../lib/error-copy.js';

// How long to wait for a reply the server is still writing after the connection dropped.
export const RECOVER_MS = 90000;
// The server sends its error cards with its own words. These two are raised here, when there is no
// connection or the answer can't be read; the second is the server's own "something went wrong".
export const OWN_CARDS = {
  network: { title: "Couldn't reach Proxi", body: 'Check your connection, then try again. Anything that already arrived is kept above.' },
  error: ERROR_COPY.error
};
