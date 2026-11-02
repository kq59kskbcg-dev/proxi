import { SELECTABLE_MODELS } from '@proxi/agent/models';
import { CONVERSATION_ID } from './db.js';
import { KINDS, MAX_ATTACHMENTS } from './attachments.js';
import { MAX_MESSAGE_CHARS, MAX_CHAT_MESSAGES } from './limits.js';

// Only these models can be requested from the browser, plus "Auto", which picks one per
// message with the routing classifier.
export const MODELS = SELECTABLE_MODELS;

// Checks the body of a chat request. Returns { error: 'invalid' } for a malformed request,
// { error: 'full' } for a chat over the message limit, or the parsed request.
export function parseChatRequest(body) {
  const auto = body?.model === 'Auto';
  const fixedModel = MODELS[body?.model];
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const lastIndex = raw.length - 1;
  const valid = raw.length > 0 && raw[0].role === 'user' && raw[lastIndex].role === 'user' && raw.every((m, i) =>
    (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && (m.role === 'assistant' || m.content.length <= MAX_MESSAGE_CHARS)
    && validAttachments(m, i === lastIndex) && (m.content.length > 0 || m.attachments?.length > 0));
  if ((!fixedModel && !auto) || !valid) return { error: 'invalid' };
  if (raw.length > MAX_CHAT_MESSAGES) return { error: 'full' };
  // A temporary chat is never saved, titled or traced.
  const temporary = body.temporary === true;
  const conversationId = !temporary && typeof body.conversationId === 'string' && CONVERSATION_ID.test(body.conversationId) ? body.conversationId : null;
  return { auto, fixedModel, messages: raw, temporary, conversationId };
}

// Files with data are only accepted on the latest message; older ones are just a kind.
function validAttachments(message, isLast) {
  if (message.attachments === undefined) return true;
  const list = message.attachments;
  return Array.isArray(list) && list.length <= MAX_ATTACHMENTS && list.every((a) => a && typeof a === 'object'
    && (typeof a.data === 'string' ? isLast : KINDS.has(a.kind)));
}

// Optional per-message labels sent back by the page (which model answered, trace ID).
export function label(value) {
  return typeof value === 'string' && value.length <= 80 ? value : null;
}
