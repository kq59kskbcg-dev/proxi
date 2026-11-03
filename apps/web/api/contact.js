import { requireUser } from '../lib/auth.js';
import { CONVERSATION_ID, hasDatabase, markContactSent } from '../lib/db.js';
import { EMAIL, contactSummary, contactLimit, sendContact } from '../lib/contact.js';
import { MAX_CHAT_MESSAGES } from '../lib/limits.js';

// POST { summary, replyTo, conversationId?, position? }: the Send button of a reply's
// "Message Lisandro" card. Emails the summary to Lisandro with replyTo as the address to answer.
// The address is used for this email only and never stored. In a saved chat, the card at
// `position` is marked as sent.
export async function POST(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error }, user.status);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid' }, 400); }
  const summary = contactSummary(body?.summary);
  const replyTo = typeof body?.replyTo === 'string' ? body.replyTo.trim() : '';
  if (!summary) return json({ error: 'invalid' }, 400);
  if (replyTo.length > 254 || !EMAIL.test(replyTo)) return json({ error: 'email' }, 400);

  const limit = contactLimit(user.userId);
  if (!limit.ok) return json({ error: 'limit' }, 429, { 'Retry-After': String(limit.retryAfter) });

  const outcome = await sendContact(summary, replyTo);
  if (outcome === 'unavailable') return json({ error: 'unavailable' }, 503);
  if (outcome === 'failed') return json({ error: 'failed' }, 502);

  const { conversationId, position } = body;
  if (typeof conversationId === 'string' && CONVERSATION_ID.test(conversationId)
    && Number.isInteger(position) && position >= 0 && position < MAX_CHAT_MESSAGES && hasDatabase()) {
    await markContactSent(user.userId, conversationId, position)
      .catch((e) => console.error('marking the card as sent failed', e?.code ?? e?.name));
  }
  return new Response(null, { status: 204 });
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}
