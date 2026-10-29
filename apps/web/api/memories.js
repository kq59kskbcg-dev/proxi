import { requireUser } from '../lib/auth.js';
import { hasDatabase, listMemories, deleteMemory, MEMORY_LIMIT } from '../lib/db.js';

const MEMORY_ID = /^[\w-]{1,64}$/;

// GET: the signed-in user's saved memories.
export async function GET(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'Memory is not set up yet.' }, 503);
  try {
    return json({ memories: await listMemories(user.userId), limit: MEMORY_LIMIT });
  } catch (error) {
    console.error('memories GET failed', error?.code ?? error?.name);
    return json({ error: 'Could not load your memories.' }, 500);
  }
}

// DELETE ?id=: deletes one of the signed-in user's memories.
export async function DELETE(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'Memory is not set up yet.' }, 503);
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !MEMORY_ID.test(id)) return json({ error: 'Invalid memory.' }, 400);
  try {
    await deleteMemory(user.userId, id);
    return json({ ok: true });
  } catch (error) {
    console.error('memories DELETE failed', error?.code ?? error?.name);
    return json({ error: 'Could not delete the memory.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
