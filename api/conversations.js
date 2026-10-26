import { requireUser } from '../lib/auth.js';
import { CONVERSATION_ID, hasDatabase, listConversations, getMessages, deleteConversation } from '../lib/db.js';

// GET: the signed-in user's chats, or one chat's messages with ?id=
export async function GET(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error }, user.status);
  if (!hasDatabase()) return json({ error: 'Chat history is not set up yet.' }, 503);

  const id = new URL(request.url).searchParams.get('id');
  try {
    if (id === null) return json({ conversations: await listConversations(user.userId) });
    if (!CONVERSATION_ID.test(id)) return json({ error: 'Invalid chat.' }, 400);
    return json({ messages: await getMessages(user.userId, id) });
  } catch (error) {
    console.error('conversations GET failed', error);
    return json({ error: 'Could not load your chats.' }, 500);
  }
}

// DELETE ?id=: removes one of the signed-in user's chats.
export async function DELETE(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error }, user.status);
  if (!hasDatabase()) return json({ error: 'Chat history is not set up yet.' }, 503);

  const id = new URL(request.url).searchParams.get('id');
  if (!id || !CONVERSATION_ID.test(id)) return json({ error: 'Invalid chat.' }, 400);
  try {
    await deleteConversation(user.userId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('conversations DELETE failed', error);
    return json({ error: 'Could not delete the chat.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
