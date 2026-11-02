import { deleteTraces } from '@proxi/agent/langfuse';
import { log } from '@proxi/agent/log';
import { json, withUser } from '../lib/http.js';
import { CONVERSATION_ID, hasDatabase, listConversations, getMessages, deleteConversation } from '../lib/db.js';

// GET: the signed-in user's chats, or one chat's messages with ?id=
export const GET = withUser(async (request, user) => {
  if (!hasDatabase()) return json({ error: 'Chat history is not set up yet.' }, 503);

  try {
    const id = chatId(request);
    if (id === null) return json({ conversations: await listConversations(user.userId) });
    if (!CONVERSATION_ID.test(id)) return json({ error: 'Invalid chat.' }, 400);
    return json({ messages: await getMessages(user.userId, id) });
  } catch (error) {
    log.error('conversations.get_failed', { error });
    return json({ error: 'Could not load your chats.', ...diagnosis(error) }, 500);
  }
});

// DELETE ?id=: removes one of the signed-in user's chats.
export const DELETE = withUser(async (request, user) => {
  if (!hasDatabase()) return json({ error: 'Chat history is not set up yet.' }, 503);

  try {
    const id = chatId(request);
    if (!id || !CONVERSATION_ID.test(id)) return json({ error: 'Invalid chat.' }, 400);
    await deleteTraces(await deleteConversation(user.userId, id));
    return new Response(null, { status: 204 });
  } catch (error) {
    log.error('conversations.delete_failed', { error });
    return json({ error: 'Could not delete the chat.', ...diagnosis(error) }, 500);
  }
});

// request.url can be a bare path on some hosts, so give it a base.
function chatId(request) {
  return new URL(request.url, 'http://localhost').searchParams.get('id');
}

// Enough to tell what went wrong without exposing anything sensitive: the
// standard 5-character Postgres error code, or the error's type name.
function diagnosis(error) {
  const code = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
  const kind = typeof error?.name === 'string' && /^\w{1,40}$/.test(error.name) ? error.name : undefined;
  return { code, kind };
}
