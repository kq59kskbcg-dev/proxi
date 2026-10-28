import { randomBytes } from 'node:crypto';
import { requireUser } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { CONVERSATION_ID, hasDatabase, shareConversation, unshareConversation } from '../lib/db.js';

// POST { id }: shares one of the signed-in user's chats and returns its link ID.
export async function POST(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!rateLimit('share:' + user.userId).ok) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  if (!hasDatabase()) return json({ error: 'Chat history is not set up yet.' }, 503);

  let body;
  try { body = await request.json(); } catch { body = null; }
  const id = body?.id;
  if (typeof id !== 'string' || !CONVERSATION_ID.test(id)) return json({ error: 'Invalid chat.' }, 400);

  try {
    const shareId = await shareConversation(user.userId, id, randomBytes(16).toString('base64url'));
    if (!shareId) return json({ error: 'Chat not found.' }, 404);
    return json({ shareId });
  } catch (error) {
    console.error('share POST failed', error);
    return json({ error: 'Could not share the chat.' }, 500);
  }
}

// DELETE ?id=: stops sharing one of the signed-in user's chats. The old link stops working.
export async function DELETE(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'Chat history is not set up yet.' }, 503);

  const id = new URL(request.url, 'http://localhost').searchParams.get('id');
  if (!id || !CONVERSATION_ID.test(id)) return json({ error: 'Invalid chat.' }, 400);
  try {
    await unshareConversation(user.userId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('share DELETE failed', error);
    return json({ error: 'Could not stop sharing the chat.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
