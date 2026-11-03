// What one message and one chat can hold. The page checks these before sending and the server
// checks again. The page imports this file too (ui/limits.js), so it must not import anything.

export const MAX_MESSAGE_CHARS = 20_000; // one message a person writes
export const MAX_EXCHANGES = 100; // messages from the user in one chat; each gets one reply
export const MAX_CHAT_MESSAGES = MAX_EXCHANGES * 2;
// A chat is saved by rewriting all its messages from what the page sends, so the whole chat is
// sent every time and a long one can't be cut short. The model only ever sees the latest ones.
//
// Replies aren't held to the 20,000 character limit above, which is for what a person types: one
// model call can write 8,000 tokens (about 32,000 characters) and Proxi adds links on top, so a
// long reply can pass 20,000. An earlier reply sent back to the model is cut to this length.
export const MAX_REPLY_CHARS = 40_000;

export const MESSAGE_TOO_LONG = `That message is too long. Messages can be up to ${MAX_MESSAGE_CHARS.toLocaleString('en-US')} characters.`;
export const CHAT_FULL = `This chat has reached its limit of ${MAX_EXCHANGES} of your messages. Start a new chat to keep going.`;
export const CHAT_TOO_LARGE = 'This chat is too large to send. Start a new chat, or try fewer or smaller attachments.';
