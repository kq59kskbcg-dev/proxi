// Chat search: a tool the model can call to look through the signed-in user's own saved chats.
// The web app runs it (it needs the user's ID); this module holds the tool definition, turns a
// query into search patterns, and turns matching messages into search results Claude can cite.
// Each result's source is a link that opens that chat in Proxi.

import { stripCitations } from './citations.js';

export const CHAT_SEARCH_TOOL = 'search_chats';
export const CHAT_SEARCH_MAX_CHATS = 5;
const MAX_SNIPPETS = 3; // passages per chat
const SNIPPET_CHARS = 300;
const MAX_WORDS = 8;

export const CHAT_SEARCH_TOOL_DEFINITION = {
  name: CHAT_SEARCH_TOOL,
  description: `Search the user's own earlier saved chats with Proxi, by title and message text. Returns up to ${CHAT_SEARCH_MAX_CHATS} chats with short passages, newest and best matches first.
Use it when the user refers to something from an earlier chat ("the hotel we picked last week", "what did you tell me about my visa?") or asks what they discussed before. Don't use it for general questions.
Search with a few distinctive keywords, not a full sentence. If nothing matches, try other keywords once, then say you couldn't find it.
It only finds saved chats: not this chat, not incognito chats, and not deleted ones. Personal details such as card numbers and email addresses are masked in saved chats.
Cite the passages you use. Don't claim to remember things that aren't in the results.`,
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'A few keywords to look for, e.g. "Lisbon hotel".' } },
    required: ['query'],
    additionalProperties: false,
  },
};

// The distinct words of a query worth searching for, lowercased.
export function searchWords(query) {
  if (typeof query !== 'string') return [];
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 2))].slice(0, MAX_WORDS);
}

// ILIKE patterns for the words, with % and _ taken literally.
export function likePatterns(words) {
  return words.map((w) => '%' + w.replace(/[\\%_]/g, '\\$&') + '%');
}

// The link a chat's search result points to: opens the chat in Proxi.
export function chatSourceUrl(origin, id) {
  return `${origin}/?chat=${encodeURIComponent(id)}`;
}

// Groups matching messages by chat, keeps the chats that match the most words (then the most
// recent), and picks each one's best passages.
// rows: [{ id, title, updatedAt, position, role, content }], most recent chats first.
export function rankChats(rows, words) {
  const chats = new Map();
  for (const row of rows) {
    let chat = chats.get(row.id);
    if (!chat) {
      chat = { id: row.id, title: row.title, updatedAt: row.updatedAt, order: chats.size, found: new Set(wordsIn(row.title, words)), messages: [] };
      chats.set(row.id, chat);
    }
    const text = clean(row.role === 'assistant' ? stripCitations(row.content) : row.content);
    const hits = wordsIn(text, words);
    hits.forEach((w) => chat.found.add(w));
    if (hits.length) chat.messages.push({ position: row.position, role: row.role, text, hits });
  }
  return [...chats.values()]
    .sort((a, b) => b.found.size - a.found.size || a.order - b.order)
    .slice(0, CHAT_SEARCH_MAX_CHATS)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      snippets: chat.messages
        .sort((a, b) => b.hits.length - a.hits.length || a.position - b.position)
        .slice(0, MAX_SNIPPETS)
        .sort((a, b) => a.position - b.position)
        .map((m) => `${m.role === 'user' ? 'User' : 'Proxi'}: ${excerpt(m.text, m.hits[0])}`),
    }));
}

// The tool_result for a search: one search result per chat, or a short note when none matched.
export function chatSearchResult(toolUseId, chats, origin) {
  if (!chats.length) {
    return { type: 'tool_result', tool_use_id: toolUseId, content: 'No saved chats matched.' };
  }
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: chats.map((chat) => ({
      type: 'search_result',
      source: chatSourceUrl(origin, chat.id),
      title: chat.title,
      content: [
        { type: 'text', text: `Chat last active ${chat.updatedAt.slice(0, 10)}.` },
        ...(chat.snippets.length ? chat.snippets : ['(Only the title matched.)']).map((text) => ({ type: 'text', text })),
      ],
      citations: { enabled: true },
    })),
  };
}

function wordsIn(text, words) {
  const lower = String(text).toLowerCase();
  return words.filter((w) => lower.includes(w));
}

function clean(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

// About SNIPPET_CHARS of the text around the first place the word appears.
function excerpt(text, word) {
  if (text.length <= SNIPPET_CHARS) return text;
  const at = Math.max(0, text.toLowerCase().indexOf(word));
  const start = Math.max(0, Math.min(at - Math.floor(SNIPPET_CHARS / 3), text.length - SNIPPET_CHARS));
  const end = start + SNIPPET_CHARS;
  return (start > 0 ? '...' : '') + text.slice(start, end).trim() + (end < text.length ? '...' : '');
}
