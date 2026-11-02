// What one message and one chat can hold. Keep these in sync with apps/web/lib/limits.js (a test checks it).
export const MAX_MESSAGE_CHARS = 20000;
export const MAX_CHAT_MESSAGES = 200; // 100 of your messages and 100 replies
export const MESSAGE_TOO_LONG = 'That message is too long. Messages can be up to 20,000 characters.';
export const CHAT_FULL = 'This chat has reached its limit of 100 of your messages. Start a new chat to keep going.';
export const CHAT_TOO_LARGE = 'This chat is too large to send. Start a new chat, or try fewer or smaller attachments.';
// How long to wait for a reply the server is still writing after the connection dropped.
export const RECOVER_MS = 90000;
// The server sends its error cards with its own words. These two are raised here, when there is no
// connection or the answer can't be read; a test keeps the second equal to the server's.
export const OWN_CARDS = {
  network: { title: "Couldn't reach Proxi", body: 'Check your connection, then try again. Anything that already arrived is kept above.' },
  error: { title: 'Something went wrong on our side', body: 'Your message is fine. Try again.' }
};
