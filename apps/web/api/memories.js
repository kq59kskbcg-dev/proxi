import { log } from '@proxi/agent/log';
import { json, withUser } from '../lib/http.js';
import { hasDatabase, listMemories, deleteMemory, MEMORY_LIMIT } from '../lib/db.js';

const MEMORY_ID = /^[\w-]{1,64}$/;

// GET: the signed-in user's saved memories.
export const GET = withUser(async (request, user) => {
  if (!hasDatabase()) return json({ error: 'Memory is not set up yet.' }, 503);
  try {
    return json({ memories: await listMemories(user.userId), limit: MEMORY_LIMIT });
  } catch (error) {
    log.error('memories.get_failed', { error });
    return json({ error: 'Could not load your memories.' }, 500);
  }
});

// DELETE ?id=: deletes one of the signed-in user's memories.
export const DELETE = withUser(async (request, user) => {
  if (!hasDatabase()) return json({ error: 'Memory is not set up yet.' }, 503);
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !MEMORY_ID.test(id)) return json({ error: 'Invalid memory.' }, 400);
  try {
    await deleteMemory(user.userId, id);
    return json({ ok: true });
  } catch (error) {
    log.error('memories.delete_failed', { error });
    return json({ error: 'Could not delete the memory.' }, 500);
  }
});
